import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueAudits } from "@/lib/schedule";

export const maxDuration = 300;

// For serverless hosts: point an external cron (Vercel Cron, GitHub Actions,
// cron-job.org) at this URL with `Authorization: Bearer $CRON_SECRET`.
// It only runs audits that are actually due, so calling it daily/hourly is fine.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const ok =
    !!secret &&
    given.length === secret.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ results: await runDueAudits() });
}
