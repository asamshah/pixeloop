import { z } from "zod";
import { db } from "@/lib/db";
import { getPlatform } from "@/lib/connections";
import type { ActionSpec, Platform } from "@/lib/platforms/types";

const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_negative_keyword"),
    campaignId: z.string().regex(/^\d+$/),
    text: z.string().min(1).max(80),
    matchType: z.enum(["EXACT", "PHRASE"]),
  }),
  z.object({
    type: z.literal("pause_keyword"),
    resourceName: z.string().regex(/^customers\/\d+\/adGroupCriteria\/\d+~\d+$/),
  }),
  z.object({
    type: z.literal("pause_meta_ad"),
    adId: z.string().regex(/^\d+$/),
  }),
]);

// Writes to the live ad account are OFF unless ADS_DRY_RUN=false is set.
export const isDryRun = () => process.env.ADS_DRY_RUN !== "false";

export async function approveRecommendation(tenantId: string, id: number) {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT * FROM recommendations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  const rec = res.rows[0];
  if (!rec) throw new Error("Recommendation not found");
  if (rec.status !== "pending") throw new Error(`Already ${rec.status}`);
  if (!rec.action_json) throw new Error("Advisory only, nothing to execute");

  const action: ActionSpec = ActionSchema.parse(JSON.parse(String(rec.action_json)));
  const dry = isDryRun();
  let ok = true;
  let message: string;

  try {
    message = dry
      ? `[DRY RUN] would execute ${action.type}`
      : await (await getPlatform(tenantId, rec.platform as Platform)).execute(action);
  } catch (e) {
    ok = false;
    message = e instanceof Error ? e.message : String(e);
  }

  await conn.batch(
    [
      {
        sql: `INSERT INTO action_log (tenant_id, recommendation_id, action_json, dry_run, ok, message) VALUES (?,?,?,?,?,?)`,
        args: [tenantId, id, JSON.stringify(action), dry ? 1 : 0, ok ? 1 : 0, message],
      },
      {
        sql: `UPDATE recommendations SET status = ?, result = ?, decided_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
        args: [ok ? (dry ? "approved_dry_run" : "executed") : "failed", message, id, tenantId],
      },
    ],
    "write",
  );
  return { ok, dryRun: dry, message };
}

export async function rejectRecommendation(tenantId: string, id: number) {
  const conn = await db();
  await conn.execute({
    sql: `UPDATE recommendations SET status = 'rejected', decided_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
    args: [id, tenantId],
  });
}
