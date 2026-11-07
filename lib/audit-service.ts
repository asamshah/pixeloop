import { db } from "@/lib/db";
import { getPlatform } from "@/lib/connections";
import { summarise } from "@/lib/agent/summarise";
import type { Platform } from "@/lib/platforms/types";

export type AuditTrigger = "manual" | "scheduled" | "mcp";

// One audit per tenant+platform at a time (guards double-clicks and the
// scheduler overlapping a manual run).
const running = new Set<string>();

export async function runAuditFor(
  tenantId: string,
  platform: Platform,
  trigger: AuditTrigger,
) {
  const key = `${tenantId}:${platform}`;
  if (running.has(key)) throw new Error("An audit is already running for this platform");
  running.add(key);
  const conn = await db();
  try {
    // Not connected is a caller error, not an audit failure: record nothing.
    const adPlatform = await getPlatform(tenantId, platform);
    let findings;
    try {
      findings = await adPlatform.audit();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await conn.execute({
        sql: `INSERT INTO audits (tenant_id, platform, window_days, trigger, error) VALUES (?,?,?,?,?)`,
        args: [tenantId, platform, adPlatform.windowDays, trigger, message],
      });
      throw e;
    }

    const summary = await summarise(findings, platform);
    const total = findings.reduce((s, f) => s + f.estimatedSaving, 0);
    const audit = await conn.execute({
      sql: `INSERT INTO audits (tenant_id, platform, window_days, summary, total_estimated_saving, finding_count, trigger) VALUES (?,?,?,?,?,?,?)`,
      args: [tenantId, platform, adPlatform.windowDays, summary, total, findings.length, trigger],
    });
    const auditId = Number(audit.lastInsertRowid);

    await conn.batch(
      [
        // Earlier pending findings for this platform are superseded.
        {
          sql: `UPDATE recommendations SET status = 'superseded' WHERE tenant_id = ? AND platform = ? AND status = 'pending'`,
          args: [tenantId, platform],
        },
        ...findings.map((f) => ({
          sql: `INSERT INTO recommendations (tenant_id, audit_id, platform, kind, title, rationale, estimated_saving, action_json) VALUES (?,?,?,?,?,?,?,?)`,
          args: [
            tenantId,
            auditId,
            platform,
            f.kind,
            f.title,
            f.rationale,
            f.estimatedSaving,
            f.action ? JSON.stringify(f.action) : null,
          ],
        })),
      ],
      "write",
    );
    return { auditId, findings: findings.length, totalEstimatedSaving: total, summary };
  } finally {
    running.delete(key);
  }
}
