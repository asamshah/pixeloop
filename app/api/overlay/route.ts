import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/tenant";
import { getLatestOverlay, refreshOverlay } from "@/lib/overlay";
import { refreshProfit } from "@/lib/profit";

export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(await getLatestOverlay(await getTenantId()));
}

export async function POST() {
  try {
    const tenantId = await getTenantId();
    const [overlay, profit] = await Promise.allSettled([
      refreshOverlay(tenantId),
      refreshProfit(tenantId),
    ]);
    if (overlay.status === "rejected") throw overlay.reason;
    return NextResponse.json({
      overlay: overlay.value,
      profitError: profit.status === "rejected" ? String(profit.reason?.message ?? profit.reason) : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
