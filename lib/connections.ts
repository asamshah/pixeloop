import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { GoogleAdsPlatform } from "@/lib/google-ads/client";
import { MetaAdsPlatform } from "@/lib/meta-ads/client";
import { ShopifyClient, SHOP_DOMAIN_RE, normaliseShopDomain } from "@/lib/shopify/client";
import { getThresholds } from "@/lib/thresholds";
import {
  PLATFORMS,
  type AdPlatform,
  type ConnectionKind,
  type IntegrationCredentials,
  type Platform,
} from "@/lib/platforms/types";
import type { AuditConfig } from "@/lib/audits/wasted-spend";
import type { MetaAuditConfig } from "@/lib/meta-ads/client";

const digits = (s: string) => s.replace(/\D/g, "");
const trim = z.string().trim();

export const isAdPlatform = (k: string): k is Platform =>
  (PLATFORMS as string[]).includes(k);

// What the connect form posts. Normalises as it validates.
export const CredentialSchemas = {
  google_ads: z.object({
    developerToken: trim.min(10),
    clientId: trim.min(10),
    clientSecret: trim.min(10),
    refreshToken: trim.min(10),
    customerId: trim.transform(digits).pipe(z.string().length(10, "Customer ID is 10 digits")),
    loginCustomerId: trim
      .optional()
      .transform((v) => (v ? digits(v) : undefined))
      .pipe(z.string().length(10).optional()),
  }),
  meta_ads: z.object({
    accessToken: trim.min(20),
    adAccountId: trim
      .transform((v) => `act_${digits(v)}`)
      .pipe(z.string().regex(/^act_\d{5,}$/, "Ad account ID looks wrong")),
  }),
  shopify: z.object({
    shop: z
      .string()
      .transform(normaliseShopDomain)
      .pipe(z.string().regex(SHOP_DOMAIN_RE, "Use your my-store.myshopify.com domain")),
    accessToken: trim.min(20),
  }),
} satisfies { [K in ConnectionKind]: z.ZodType<IntegrationCredentials[K], unknown> };

export function buildPlatform(
  platform: Platform,
  creds: IntegrationCredentials[Platform],
  cfg?: AuditConfig | MetaAuditConfig,
): AdPlatform {
  if (platform === "google_ads") {
    return new GoogleAdsPlatform(
      creds as IntegrationCredentials["google_ads"],
      cfg as AuditConfig | undefined,
    );
  }
  return new MetaAdsPlatform(
    creds as IntegrationCredentials["meta_ads"],
    cfg as MetaAuditConfig | undefined,
  );
}

export async function saveConnection<K extends ConnectionKind>(
  tenantId: string,
  kind: K,
  creds: IntegrationCredentials[K],
  displayName: string,
) {
  const conn = await db();
  await conn.execute({
    sql: `INSERT INTO connections (tenant_id, platform, credentials_enc, display_name, status)
          VALUES (?,?,?,?, 'connected')
          ON CONFLICT (tenant_id, platform) DO UPDATE SET
            credentials_enc = excluded.credentials_enc,
            display_name = excluded.display_name,
            status = 'connected'`,
    args: [tenantId, kind, encrypt(JSON.stringify(creds)), displayName],
  });
}

export async function deleteConnection(tenantId: string, kind: ConnectionKind) {
  const conn = await db();
  await conn.execute({
    sql: `DELETE FROM connections WHERE tenant_id = ? AND platform = ?`,
    args: [tenantId, kind],
  });
}

export interface ConnectionInfo {
  platform: ConnectionKind;
  displayName: string | null;
  status: string;
  createdAt: string;
}

/** Safe for the UI/MCP: never includes credentials. */
export async function listConnections(tenantId: string): Promise<ConnectionInfo[]> {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT platform, display_name, status, created_at FROM connections WHERE tenant_id = ?`,
    args: [tenantId],
  });
  return res.rows.map((r) => ({
    platform: r.platform as ConnectionKind,
    displayName: r.display_name == null ? null : String(r.display_name),
    status: String(r.status),
    createdAt: String(r.created_at),
  }));
}

async function loadCredentials<K extends ConnectionKind>(
  tenantId: string,
  kind: K,
): Promise<IntegrationCredentials[K]> {
  const conn = await db();
  const res = await conn.execute({
    sql: `SELECT credentials_enc FROM connections WHERE tenant_id = ? AND platform = ?`,
    args: [tenantId, kind],
  });
  const row = res.rows[0];
  if (!row) throw new Error(`${kind} is not connected`);
  return JSON.parse(decrypt(String(row.credentials_enc)));
}

/** An ad platform wired up with this tenant's credentials and thresholds. */
export async function getPlatform(tenantId: string, platform: Platform): Promise<AdPlatform> {
  const [creds, thresholds] = await Promise.all([
    loadCredentials(tenantId, platform),
    getThresholds(tenantId),
  ]);
  return buildPlatform(platform, creds, thresholds[platform]);
}

export async function getShopify(tenantId: string): Promise<ShopifyClient> {
  return new ShopifyClient(await loadCredentials(tenantId, "shopify"));
}

export async function hasShopify(tenantId: string): Promise<boolean> {
  return (await listConnections(tenantId)).some((c) => c.platform === "shopify");
}
