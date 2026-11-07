import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { setScheduleEnabled } from "@/lib/schedule";

export async function POST(req: Request) {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await req.json());
  await setScheduleEnabled(await getTenantId(), enabled);
  return NextResponse.json({ ok: true });
}
