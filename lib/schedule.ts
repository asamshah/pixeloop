import { db } from "@/lib/db";
import { runAuditFor } from "@/lib/audit-service";
import { parseDbDate } from "@/lib/time";
import { hasShopify } from "@/lib/connections";
import { refreshOverlayIfStale } from "@/lib/overlay";
import { refreshProfitIfStale } from "@/lib/profit";
import type { Platform } from "@/lib/platforms/types";

export const AUDIT_INTERVAL_DAYS = 7;
const RETRY_AFTER_FAILURE_HOURS = 6;
const DAY = 86_400_000;

export async function isScheduleEnabled(tenantId: string): Promise<boolean> {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT value FROM settings WHERE tenant_id = ? AND key = 'weekly_audit_enabled'`,
    args: [tenantId],
  });
  return res.rows[0] ? res.rows[0].value === "true" : true; // on by default
}

export async function setScheduleEnabled(tenantId: string, enabled: boolean) {
  const conn = await db();
  await conn.execute({
    sql: `INSERT INTO settings (tenant_id, key, value) VALUES (?, 'weekly_audit_enabled', ?)
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value`,
    args: [tenantId, String(enabled)],
  });
}

export interface PlatformSchedule {
  platform: Platform;
  lastRunAt: Date | null;
  lastFailed: boolean;
  nextRunAt: Date;
  due: boolean;
}

/** When each connected platform is next due. Manual runs also reset the clock. */
export async function getPlatformSchedules(tenantId: string): Promise<PlatformSchedule[]> {
  const conn = await db();
  const [connected, last] = await Promise.all([
    conn.execute({ sql: `SELECT platform FROM connections WHERE tenant_id = ? AND platform IN ('google_ads','meta_ads')`, args: [tenantId] }),
    conn.execute({
      sql: `SELECT platform, created_at, error FROM audits
            WHERE tenant_id = ? AND id IN (SELECT MAX(id) FROM audits WHERE tenant_id = ? GROUP BY platform)`,
      args: [tenantId, tenantId],
    }),
  ]);
  const lastBy = new Map(last.rows.map((r) => [String(r.platform), r]));
  return connected.rows.map((c) => {
    const platform = c.platform as Platform;
    const l = lastBy.get(platform);
    const lastRunAt = l ? parseDbDate(String(l.created_at)) : null;
    const lastFailed = !!l?.error;
    const nextRunAt = !lastRunAt
      ? new Date() // never audited: due now
      : new Date(
          lastRunAt.getTime() +
            (lastFailed ? RETRY_AFTER_FAILURE_HOURS * 3_600_000 : AUDIT_INTERVAL_DAYS * DAY),
        );
    return { platform, lastRunAt, lastFailed, nextRunAt, due: nextRunAt.getTime() <= Date.now() };
  });
}

/** Runs every audit that is due, for every tenant. Safe to call as often as you like. */
export async function runDueAudits() {
  const conn = await db();
  const tenants = await conn.execute(
    `SELECT DISTINCT tenant_id FROM connections WHERE platform IN ('google_ads','meta_ads')`,
  );
  const results: { tenantId: string; platform: Platform; ok: boolean; message: string }[] = [];

  for (const t of tenants.rows) {
    const tenantId = String(t.tenant_id);
    if (!(await isScheduleEnabled(tenantId))) continue;
    // Keep the Shopify revenue overlay fresh (best-effort, at most daily).
    if (await hasShopify(tenantId)) {
      try {
        await refreshOverlayIfStale(tenantId, 24);
        await refreshProfitIfStale(tenantId, 24);
      } catch (e) {
        console.error("[scheduler] overlay/profit refresh failed:", e);
      }
    }
    for (const s of await getPlatformSchedules(tenantId)) {
      if (!s.due) continue;
      try {
        const r = await runAuditFor(tenantId, s.platform, "scheduled");
        results.push({ tenantId, platform: s.platform, ok: true, message: `${r.findings} findings` });
      } catch (e) {
        results.push({
          tenantId,
          platform: s.platform,
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return results;
}

// In-process scheduler for self-hosted / `next start`. On serverless hosts use
// the /api/cron/audit endpoint with an external cron instead (see README).
const g = globalThis as unknown as { __adsSchedulerStarted?: boolean };

export function startScheduler() {
  if (g.__adsSchedulerStarted) return;
  g.__adsSchedulerStarted = true;
  const tick = () =>
    runDueAudits().catch((e) => console.error("[scheduler] run failed:", e));
  setTimeout(tick, 15_000); // shortly after boot
  setInterval(tick, 15 * 60_000).unref?.();
}
