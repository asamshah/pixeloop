// Platform-agnostic contract. Each platform runs its own audit (Google has
// keywords/search terms, Meta has ads/ad sets) and returns the same Finding
// shape, so the DB, dashboard, scheduler and MCP server never care which.

export type Platform = "google_ads" | "meta_ads";
export const PLATFORMS: Platform[] = ["google_ads", "meta_ads"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
};

export type ActionSpec =
  | {
      type: "add_negative_keyword";
      campaignId: string;
      text: string;
      matchType: "EXACT" | "PHRASE";
    }
  | { type: "pause_keyword"; resourceName: string }
  | { type: "pause_meta_ad"; adId: string };

export type FindingKind =
  | "wasted_search_term"
  | "zero_conversion_keyword"
  | "low_quality_score"
  | "budget_capped"
  | "zero_conversion_ad"
  | "ad_fatigue"
  | "low_ctr_ad";

export interface Finding {
  kind: FindingKind;
  title: string;
  rationale: string;
  estimatedSaving: number; // projected over the next 30 days
  action: ActionSpec | null; // null = advisory only
}

/** Account-level spend and what the platform *claims* it drove. */
export interface SpendSummary {
  spend: number;
  currency: string;
  reportedConversionValue: number; // platform-attributed revenue
  reportedConversions: number;
}

export interface AdPlatform {
  platform: Platform;
  windowDays: number;
  audit(): Promise<Finding[]>;
  fetchSpend(days: number): Promise<SpendSummary>;
  execute(action: ActionSpec): Promise<string>;
  /** Cheap call proving the credentials work. Returns a display name. */
  testConnection(): Promise<string>;
}

// ---- Credential shapes stored (encrypted) per tenant ----
export interface GoogleAdsCredentials {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // digits only
  loginCustomerId?: string; // digits only, MCC
}

export interface MetaAdsCredentials {
  accessToken: string; // long-lived user or system-user token
  adAccountId: string; // "act_123..." (normalised)
}

export interface ShopifyCredentials {
  shop: string; // my-store.myshopify.com
  accessToken: string; // Admin API token from a custom app (shpat_...)
}

export type Credentials = {
  google_ads: GoogleAdsCredentials;
  meta_ads: MetaAdsCredentials;
};

// Everything that can be connected. Only `Platform`s are audited.
export type IntegrationCredentials = Credentials & { shopify: ShopifyCredentials };
export type ConnectionKind = keyof IntegrationCredentials;
export const CONNECTION_LABEL: Record<ConnectionKind, string> = {
  ...PLATFORM_LABEL,
  shopify: "Shopify",
};
