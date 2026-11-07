import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import {
  buildPlatform,
  CredentialSchemas,
  deleteConnection,
  isAdPlatform,
  listConnections,
  saveConnection,
} from "@/lib/connections";
import { ShopifyClient } from "@/lib/shopify/client";
import { refreshOverlay } from "@/lib/overlay";
import { refreshProfit } from "@/lib/profit";
import type { ConnectionKind, IntegrationCredentials } from "@/lib/platforms/types";

const Kinds = z.enum(["google_ads", "meta_ads", "shopify"] as [ConnectionKind, ...ConnectionKind[]]);

export async function GET() {
  return NextResponse.json(await listConnections(await getTenantId()));
}

async function testConnection(kind: ConnectionKind, creds: unknown): Promise<string> {
  if (kind === "shopify") {
    return new ShopifyClient(creds as IntegrationCredentials["shopify"]).testConnection();
  }
  if (isAdPlatform(kind)) {
    return buildPlatform(kind, creds as IntegrationCredentials[typeof kind]).testConnection();
  }
  throw new Error("Unknown connection type");
}

// Validates, proves the credentials work against the real API, then stores
// them encrypted. Credentials are never returned by any endpoint.
export async function POST(req: Request) {
  try {
    const { platform, credentials } = z
      .object({ platform: Kinds, credentials: z.unknown() })
      .parse(await req.json());

    const parsed = CredentialSchemas[platform].safeParse(credentials);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        { error: `${issue.path.join(".") || "credentials"}: ${issue.message}` },
        { status: 400 },
      );
    }

    let name: string;
    try {
      name = await testConnection(platform, parsed.data);
    } catch (e) {
      return NextResponse.json(
        { error: `Could not connect: ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 },
      );
    }

    const tenantId = await getTenantId();
    await saveConnection(tenantId, platform, parsed.data as never, name);
    // Connecting Shopify (or another source) changes the revenue overlay: refresh it.
    if (platform === "shopify" || (await listConnections(tenantId)).some((c) => c.platform === "shopify")) {
      await refreshOverlay(tenantId).catch(() => undefined);
      // Product costs read every line item, so do it in the background.
      if (platform === "shopify") void refreshProfit(tenantId).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, displayName: name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const { platform } = z.object({ platform: Kinds }).parse(await req.json());
  await deleteConnection(await getTenantId(), platform);
  return NextResponse.json({ ok: true });
}
