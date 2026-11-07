import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { getThresholds, ThresholdSchema, updateThresholds } from "@/lib/thresholds";

export async function GET() {
  return NextResponse.json(await getThresholds(await getTenantId()));
}

const Body = z.object({
  patch: ThresholdSchema.optional(),
  reset: z.array(z.enum(["google_ads", "meta_ads", "overlay"])).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return NextResponse.json({ error: `${i.path.join(".")}: ${i.message}` }, { status: 400 });
  }
  const tenantId = await getTenantId();
  await updateThresholds(tenantId, parsed.data.patch ?? {}, parsed.data.reset);
  return NextResponse.json(await getThresholds(tenantId));
}
