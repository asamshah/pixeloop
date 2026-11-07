import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import {
  approveRecommendation,
  rejectRecommendation,
} from "@/lib/actions/execute";

const Body = z.object({ decision: z.enum(["approve", "reject"]) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const recId = Number(id);
    if (!Number.isInteger(recId)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    const { decision } = Body.parse(await req.json());
    const tenantId = await getTenantId();

    if (decision === "reject") {
      await rejectRecommendation(tenantId, recId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await approveRecommendation(tenantId, recId));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
