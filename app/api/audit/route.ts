import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { runAuditFor } from "@/lib/audit-service";
import { PLATFORMS } from "@/lib/platforms/types";

export const maxDuration = 120;

const Body = z.object({ platform: z.enum(PLATFORMS as [string, ...string[]]) });

export async function POST(req: Request) {
  try {
    const { platform } = Body.parse(await req.json());
    const result = await runAuditFor(
      await getTenantId(),
      platform as (typeof PLATFORMS)[number],
      "manual",
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
