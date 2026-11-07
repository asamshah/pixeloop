import { db } from "@/lib/db";
import type { Platform } from "@/lib/platforms/types";

export async function listRecommendations(
  tenantId: string,
  opts: { status?: string; platform?: Platform; limit?: number } = {},
) {
  const conn = await db();
  const where = ["tenant_id = ?"];
  const args: (string | number)[] = [tenantId];
  if (opts.status) { where.push("status = ?"); args.push(opts.status); }
  if (opts.platform) { where.push("platform = ?"); args.push(opts.platform); }
  args.push(opts.limit ?? 100);
  const res = await conn.execute({
    sql: `SELECT id, platform, kind, title, rationale, estimated_saving, status, result, action_json, created_at
          FROM recommendations WHERE ${where.join(" AND ")}
          ORDER BY estimated_saving DESC, id DESC LIMIT ?`,
    args,
  });
  return res.rows;
}

export async function listAudits(tenantId: string, limit = 10) {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT id, platform, summary, total_estimated_saving, finding_count, trigger, error, created_at
          FROM audits WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
    args: [tenantId, limit],
  });
  return res.rows;
}

export async function listActionLog(tenantId: string, limit = 10) {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT id, ok, dry_run, message, created_at FROM action_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
    args: [tenantId, limit],
  });
  return res.rows;
}
