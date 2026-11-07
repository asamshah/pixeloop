import { db } from "@/lib/db";
import { getShopify } from "@/lib/connections";
import type { ProductSales } from "@/lib/shopify/client";
import { getThresholds } from "@/lib/thresholds";
import { parseDbDate } from "@/lib/time";

export interface ProductProfitRow {
  title: string;
  units: number;
  revenue: number;
  cost: number; // known costs only
  profit: number | null; // null when cost is unknown
  marginPercent: number | null;
  missingCostUnits: number;
}

export interface ProfitSnapshot {
  computedAt: string;
  windowDays: number;
  currency: string;
  ordersScanned: number;
  truncated: boolean; // sample of most recent orders
  // Share of product sales whose cost Shopify knows (0..1).
  costCoverage: number;
  // Product costs as a share of sales, from lines with known cost. null if unknowable.
  costRatio: number | null;
  productsMissingCost: number;
  products: ProductProfitRow[]; // top sellers by revenue (max 50)
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildProfit(
  raw: { currency: string; ordersScanned: number; truncated: boolean; products: ProductSales[] },
  windowDays: number,
): ProfitSnapshot {
  const totalRev = raw.products.reduce((t, p) => t + p.revenue, 0);
  const costedRev = raw.products.reduce((t, p) => t + p.costedRevenue, 0);
  const costTotal = raw.products.reduce((t, p) => t + p.cost, 0);
  const coverage = totalRev > 0 ? costedRev / totalRev : 0;

  const rows: ProductProfitRow[] = raw.products
    .sort((a, b) => b.revenue - a.revenue)
    .map((p) => {
      const known = p.unitsMissingCost === 0 && p.costedRevenue > 0;
      return {
        title: p.title,
        units: p.units,
        revenue: r2(p.revenue),
        cost: r2(p.cost),
        profit: known ? r2(p.revenue - p.cost) : null,
        marginPercent: known && p.revenue > 0 ? r2(((p.revenue - p.cost) / p.revenue) * 100) : null,
        missingCostUnits: p.unitsMissingCost,
      };
    });

  return {
    computedAt: new Date().toISOString(),
    windowDays,
    currency: raw.currency,
    ordersScanned: raw.ordersScanned,
    truncated: raw.truncated,
    costCoverage: r2(coverage),
    // Only trust the ratio if costs are known for at least half of sales.
    costRatio: coverage >= 0.5 && costedRev > 0 ? r2(costTotal / costedRev) : null,
    productsMissingCost: raw.products.filter((p) => p.unitsMissingCost > 0).length,
    products: rows.slice(0, 50),
  };
}

export async function refreshProfit(tenantId: string): Promise<ProfitSnapshot> {
  const cfg = (await getThresholds(tenantId)).overlay;
  const raw = await (await getShopify(tenantId)).fetchProductSales(cfg.windowDays);
  const snap = buildProfit(raw, cfg.windowDays);
  const conn = await db();
  await conn.execute({
    sql: `INSERT INTO snapshots (tenant_id, kind, computed_at, data) VALUES (?, 'profit', ?, ?)
          ON CONFLICT (tenant_id, kind) DO UPDATE SET computed_at = excluded.computed_at, data = excluded.data`,
    args: [tenantId, snap.computedAt, JSON.stringify(snap)],
  });
  return snap;
}

export async function getLatestProfit(tenantId: string): Promise<ProfitSnapshot | null> {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT data FROM snapshots WHERE tenant_id = ? AND kind = 'profit'`,
    args: [tenantId],
  });
  return res.rows[0] ? (JSON.parse(String(res.rows[0].data)) as ProfitSnapshot) : null;
}

export async function refreshProfitIfStale(tenantId: string, maxAgeHours: number) {
  const latest = await getLatestProfit(tenantId);
  if (latest && Date.now() - parseDbDate(latest.computedAt).getTime() < maxAgeHours * 3_600_000) {
    return latest;
  }
  return refreshProfit(tenantId);
}
