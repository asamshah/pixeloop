import { db } from "@/lib/db";
import { getShopify, listConnections, getPlatform, isAdPlatform } from "@/lib/connections";
import { getThresholds, type OverlayConfig } from "@/lib/thresholds";
import { parseDbDate } from "@/lib/time";
import type { Platform } from "@/lib/platforms/types";
import { PLATFORM_LABEL } from "@/lib/platforms/types";

export interface PlatformOverlay {
  platform: Platform;
  spend: number;
  currency: string;
  reportedRevenue: number; // what the ad platform claims
  reportedConversions: number;
  reportedRoas: number | null;
  error?: string;
}

export interface OverlaySnapshot {
  computedAt: string; // ISO
  windowDays: number;
  shop: {
    name: string;
    currency: string;
    netRevenue: number;
    orders: number;
    newCustomers: number;
    aov: number;
    truncated: boolean;
  };
  platforms: PlatformOverlay[];
  totals: {
    adSpend: number; // only platforms in the shop's currency
    mer: number | null; // net revenue / ad spend
    blendedCac: number | null; // ad spend / new customers
    reportedRevenue: number;
    attributionRatio: number | null; // platform-claimed / Shopify net revenue
    currencyMismatch: boolean;
  };
}

export interface Insight {
  level: "warn" | "info";
  text: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function computeOverlay(tenantId: string): Promise<OverlaySnapshot> {
  const cfg = (await getThresholds(tenantId)).overlay;
  const shopify = await getShopify(tenantId);
  const sales = await shopify.fetchSales(cfg.windowDays);

  const adConns = (await listConnections(tenantId)).filter((c) => isAdPlatform(c.platform));
  const platforms: PlatformOverlay[] = await Promise.all(
    adConns.map(async (c): Promise<PlatformOverlay> => {
      const platform = c.platform as Platform;
      try {
        const s = await (await getPlatform(tenantId, platform)).fetchSpend(cfg.windowDays);
        return {
          platform,
          spend: r2(s.spend),
          currency: s.currency,
          reportedRevenue: r2(s.reportedConversionValue),
          reportedConversions: r2(s.reportedConversions),
          reportedRoas: s.spend > 0 ? r2(s.reportedConversionValue / s.spend) : null,
        };
      } catch (e) {
        return {
          platform, spend: 0, currency: "", reportedRevenue: 0, reportedConversions: 0,
          reportedRoas: null, error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  // Never add spend across currencies.
  const comparable = platforms.filter((p) => !p.error && p.currency === sales.currency);
  const currencyMismatch = platforms.some((p) => !p.error && p.currency && p.currency !== sales.currency);
  const adSpend = comparable.reduce((t, p) => t + p.spend, 0);
  const reportedRevenue = comparable.reduce((t, p) => t + p.reportedRevenue, 0);

  return {
    computedAt: new Date().toISOString(),
    windowDays: cfg.windowDays,
    shop: {
      name: sales.shopName,
      currency: sales.currency,
      netRevenue: r2(sales.netRevenue),
      orders: sales.orders,
      newCustomers: sales.newCustomers,
      aov: r2(sales.aov),
      truncated: sales.truncated,
    },
    platforms,
    totals: {
      adSpend: r2(adSpend),
      mer: adSpend > 0 ? r2(sales.netRevenue / adSpend) : null,
      blendedCac: adSpend > 0 && sales.newCustomers > 0 ? r2(adSpend / sales.newCustomers) : null,
      reportedRevenue: r2(reportedRevenue),
      attributionRatio: sales.netRevenue > 0 && comparable.length ? r2(reportedRevenue / sales.netRevenue) : null,
      currencyMismatch,
    },
  };
}

/** Pure: turns a snapshot + this tenant's thresholds into plain-English flags. */
export function insightsFor(s: OverlaySnapshot, cfg: OverlayConfig): Insight[] {
  const out: Insight[] = [];
  const cur = s.shop.currency;
  const t = s.totals;

  if (s.shop.truncated) {
    out.push({ level: "info", text: "Shopify order volume hit the sync cap, so revenue is a lower bound and MER is understated." });
  }
  if (t.currencyMismatch) {
    out.push({ level: "warn", text: `Some ad accounts are not in ${cur}; they are excluded from MER and CAC.` });
  }
  for (const p of s.platforms.filter((p) => p.error)) {
    out.push({ level: "warn", text: `${PLATFORM_LABEL[p.platform]} spend could not be read: ${p.error}` });
  }
  if (cfg.targetMer > 0 && t.mer != null && t.mer < cfg.targetMer) {
    out.push({
      level: "warn",
      text: `Blended MER is ${t.mer.toFixed(2)}, below your ${cfg.targetMer} target. Every ${cur} of ad spend returned ${t.mer.toFixed(2)} of Shopify revenue.`,
    });
  }
  if (t.attributionRatio != null && t.attributionRatio > cfg.maxAttributionGap) {
    out.push({
      level: "warn",
      text: `Ad platforms together claim ${(t.attributionRatio * 100).toFixed(0)}% of your Shopify revenue (limit ${(cfg.maxAttributionGap * 100).toFixed(0)}%). They are double-counting the same sales, so trust MER over platform ROAS.`,
    });
  }
  if (!out.length && t.mer != null) {
    out.push({ level: "info", text: "Platform-reported revenue is consistent with Shopify and MER meets your target." });
  }
  return out;
}

export async function saveOverlay(tenantId: string, s: OverlaySnapshot) {
  const conn = await db();
  await conn.execute({
    sql: `INSERT INTO overlay_snapshots (tenant_id, computed_at, data) VALUES (?,?,?)
          ON CONFLICT (tenant_id) DO UPDATE SET computed_at = excluded.computed_at, data = excluded.data`,
    args: [tenantId, s.computedAt, JSON.stringify(s)],
  });
}

export async function getLatestOverlay(tenantId: string): Promise<OverlaySnapshot | null> {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT data FROM overlay_snapshots WHERE tenant_id = ?`,
    args: [tenantId],
  });
  return res.rows[0] ? (JSON.parse(String(res.rows[0].data)) as OverlaySnapshot) : null;
}

export async function refreshOverlay(tenantId: string): Promise<OverlaySnapshot> {
  const s = await computeOverlay(tenantId);
  await saveOverlay(tenantId, s);
  return s;
}

/** Used by the scheduler and MCP: only recompute when the snapshot is old. */
export async function refreshOverlayIfStale(tenantId: string, maxAgeHours: number) {
  const latest = await getLatestOverlay(tenantId);
  if (latest && Date.now() - parseDbDate(latest.computedAt).getTime() < maxAgeHours * 3_600_000) {
    return latest;
  }
  return refreshOverlay(tenantId);
}
