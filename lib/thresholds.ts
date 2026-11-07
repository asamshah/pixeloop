import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_CONFIG, type AuditConfig } from "@/lib/audits/wasted-spend";
import { META_DEFAULT_CONFIG, type MetaAuditConfig } from "@/lib/meta-ads/client";

export interface OverlayConfig {
  windowDays: number;
  /** Blended revenue / ad spend below this is flagged. 0 disables. */
  targetMer: number;
  /** Platform-claimed revenue / Shopify revenue above this is flagged as over-attribution. */
  maxAttributionGap: number;
  /** Payment fees, shipping and fulfilment as % of sales, subtracted from profit. */
  otherCostsPercent: number;
}
export const OVERLAY_DEFAULT_CONFIG: OverlayConfig = {
  windowDays: 30,
  targetMer: 2,
  maxAttributionGap: 1.3,
  otherCostsPercent: 0,
};

export interface Thresholds {
  google_ads: AuditConfig;
  meta_ads: MetaAuditConfig;
  overlay: OverlayConfig;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  google_ads: DEFAULT_CONFIG,
  meta_ads: META_DEFAULT_CONFIG,
  overlay: OVERLAY_DEFAULT_CONFIG,
};

const money = z.number().min(0).max(1_000_000);
const days = z.number().int().min(7).max(90);

// Strict: unknown keys are rejected, so typos don't silently do nothing.
export const ThresholdSchema = z.object({
  google_ads: z
    .object({
      windowDays: days,
      minWastedTermCost: money,
      minWastedTermClicks: z.number().int().min(0).max(100_000),
      minKeywordCost: money,
      minKeywordClicks: z.number().int().min(0).max(100_000),
      lowQualityScore: z.number().int().min(1).max(10),
      budgetLostShareThreshold: z.number().min(0).max(1),
    })
    .partial()
    .strict(),
  meta_ads: z
    .object({
      windowDays: days,
      minAdCost: money,
      minAdClicks: z.number().int().min(0).max(100_000),
      fatigueFrequency: z.number().min(1).max(50),
      fatigueMinCost: money,
      lowCtrPercent: z.number().min(0).max(100),
      lowCtrMinImpressions: z.number().int().min(0).max(100_000_000),
      lowCtrMinCost: money,
    })
    .partial()
    .strict(),
  overlay: z
    .object({
      windowDays: days,
      targetMer: z.number().min(0).max(100),
      maxAttributionGap: z.number().min(1).max(10),
      otherCostsPercent: z.number().min(0).max(60),
    })
    .partial()
    .strict(),
}).partial().strict();

export type ThresholdOverrides = z.infer<typeof ThresholdSchema>;

const KEY = "thresholds";

async function loadOverrides(tenantId: string): Promise<ThresholdOverrides> {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT value FROM settings WHERE tenant_id = ? AND key = ?`,
    args: [tenantId, KEY],
  });
  if (!res.rows[0]) return {};
  const parsed = ThresholdSchema.safeParse(JSON.parse(String(res.rows[0].value)));
  return parsed.success ? parsed.data : {}; // ignore corrupt/legacy values
}

/** Defaults merged with this tenant's overrides. */
export async function getThresholds(tenantId: string): Promise<Thresholds> {
  const o = await loadOverrides(tenantId);
  return {
    google_ads: { ...DEFAULT_THRESHOLDS.google_ads, ...o.google_ads },
    meta_ads: { ...DEFAULT_THRESHOLDS.meta_ads, ...o.meta_ads },
    overlay: { ...DEFAULT_THRESHOLDS.overlay, ...o.overlay },
  };
}

/** Merges a partial update into the stored overrides. Pass `reset` to clear a section. */
export async function updateThresholds(
  tenantId: string,
  patch: ThresholdOverrides,
  reset?: (keyof Thresholds)[],
) {
  const current = await loadOverrides(tenantId);
  const next: ThresholdOverrides = { ...current };
  for (const k of reset ?? []) delete next[k];
  for (const k of Object.keys(patch) as (keyof Thresholds)[]) {
    next[k] = { ...(next[k] as object), ...(patch[k] as object) } as never;
  }
  const conn = await db();
  await conn.execute({
    sql: `INSERT INTO settings (tenant_id, key, value) VALUES (?,?,?)
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value`,
    args: [tenantId, KEY, JSON.stringify(next)],
  });
}
