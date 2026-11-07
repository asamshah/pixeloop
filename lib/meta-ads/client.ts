import type {
  ActionSpec,
  AdPlatform,
  Finding,
  MetaAdsCredentials,
  SpendSummary,
} from "@/lib/platforms/types";

// Talks to the Marketing (Graph) API over plain fetch: no SDK to bundle.
// META_GRAPH_URL exists so tests can point at a local mock.
const GRAPH_HOST = process.env.META_GRAPH_URL ?? "https://graph.facebook.com";
const GRAPH = `${GRAPH_HOST}/${process.env.META_API_VERSION ?? "v23.0"}`;

export interface MetaAuditConfig {
  windowDays: number;
  minAdCost: number; // spend before a zero-conversion ad is flagged
  minAdClicks: number;
  fatigueFrequency: number;
  fatigueMinCost: number;
  lowCtrPercent: number;
  lowCtrMinImpressions: number;
  lowCtrMinCost: number;
}

export const META_DEFAULT_CONFIG: MetaAuditConfig = {
  windowDays: 30,
  minAdCost: 40,
  minAdClicks: 30,
  fatigueFrequency: 4,
  fatigueMinCost: 30,
  lowCtrPercent: 0.5,
  lowCtrMinImpressions: 5000,
  lowCtrMinCost: 30,
};

// Action types that count as a conversion. Override per tenant later.
const CONVERSION_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "lead",
  "offsite_conversion.fb_pixel_lead",
  "omni_complete_registration",
]);

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

interface InsightRow {
  ad_id: string;
  ad_name: string;
  adset_name: string;
  campaign_name: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  frequency?: string;
  actions?: { action_type: string; value: string }[];
}

interface GraphError {
  error?: { message?: string; code?: number };
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => n.toFixed(2);

export class MetaAdsPlatform implements AdPlatform {
  platform = "meta_ads" as const;
  windowDays: number;

  constructor(
    private creds: MetaAdsCredentials,
    private cfg: MetaAuditConfig = META_DEFAULT_CONFIG,
  ) {
    this.windowDays = cfg.windowDays;
  }

  private async graph<T>(
    path: string,
    params: Record<string, string> = {},
    method: "GET" | "POST" = "GET",
  ): Promise<T> {
    const body = new URLSearchParams({ ...params, access_token: this.creds.accessToken });
    // Token goes in the Authorization header / POST body, never in the URL.
    const res =
      method === "GET"
        ? await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`, {
            headers: { Authorization: `Bearer ${this.creds.accessToken}` },
          })
        : await fetch(`${GRAPH}/${path}`, { method, body });
    const json = (await res.json()) as T & GraphError;
    if (!res.ok || json.error) {
      throw new Error(`Meta API: ${json.error?.message ?? res.statusText}`);
    }
    return json;
  }

  async testConnection(): Promise<string> {
    const a = await this.graph<{ name?: string; currency?: string; account_status?: number }>(
      this.creds.adAccountId,
      { fields: "name,currency,account_status" },
    );
    if (a.account_status !== undefined && a.account_status !== 1) {
      throw new Error(`Ad account is not active (account_status=${a.account_status})`);
    }
    return `${a.name ?? this.creds.adAccountId} (${a.currency ?? "?"})`;
  }

  private async fetchAdInsights(days: number): Promise<InsightRow[]> {
    const until = new Date();
    const since = new Date(Date.now() - days * 86_400_000);
    const rows: InsightRow[] = [];
    let next: string | null = null;
    let first = true;
    for (let page = 0; page < 20; page++) {
      let json: { data: InsightRow[]; paging?: { next?: string } };
      if (first) {
        json = await this.graph(`${this.creds.adAccountId}/insights`, {
          level: "ad",
          fields: "ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,ctr,frequency,actions",
          time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }),
          filtering: JSON.stringify([
            { field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] },
          ]),
          limit: "200",
        });
        first = false;
      } else {
        // paging.next is a full URL; only follow it if it stays on Graph.
        if (!next || !next.startsWith(`${GRAPH_HOST}/`)) break;
        const res = await fetch(next, {
          headers: { Authorization: `Bearer ${this.creds.accessToken}` },
        });
        json = await res.json();
      }
      rows.push(...(json.data ?? []));
      next = json.paging?.next ?? null;
      if (!next) break;
    }
    return rows;
  }

  async fetchSpend(days: number): Promise<SpendSummary> {
    const until = new Date();
    const since = new Date(Date.now() - days * 86_400_000);
    const [acct, ins] = await Promise.all([
      this.graph<{ currency?: string }>(this.creds.adAccountId, { fields: "currency" }),
      this.graph<{
        data: {
          spend?: string;
          actions?: { action_type: string; value: string }[];
          action_values?: { action_type: string; value: string }[];
        }[];
      }>(`${this.creds.adAccountId}/insights`, {
        level: "account",
        fields: "spend,actions,action_values",
        time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }),
      }),
    ]);
    const row = ins.data?.[0];
    // Meta lists the same purchase under several action types (purchase,
    // omni_purchase, pixel). Take the largest, not the sum, to avoid double counting.
    const max = (xs?: { action_type: string; value: string }[]) =>
      Math.max(0, ...(xs ?? []).filter((a) => PURCHASE_ACTIONS.has(a.action_type)).map((a) => Number(a.value)));
    return {
      spend: Number(row?.spend ?? 0),
      currency: acct.currency ?? "",
      reportedConversionValue: max(row?.action_values),
      reportedConversions: max(row?.actions),
    };
  }

  async audit(): Promise<Finding[]> {
    const cfg = this.cfg;
    const rows = await this.fetchAdInsights(cfg.windowDays);
    const project = (cost: number) => (cost / cfg.windowDays) * 30;
    const findings: Finding[] = [];

    for (const r of rows) {
      const cost = Number(r.spend ?? 0);
      const clicks = Number(r.clicks ?? 0);
      const impressions = Number(r.impressions ?? 0);
      const ctr = Number(r.ctr ?? 0); // already a percentage
      const freq = Number(r.frequency ?? 0);
      const conversions = (r.actions ?? [])
        .filter((a) => CONVERSION_ACTIONS.has(a.action_type))
        .reduce((s, a) => s + Number(a.value), 0);
      const label = `"${r.ad_name}" (${r.adset_name})`;

      if (conversions === 0 && cost >= cfg.minAdCost && clicks >= cfg.minAdClicks) {
        findings.push({
          kind: "zero_conversion_ad",
          title: `Pause ad ${label}`,
          rationale: `Spent ${money(cost)} over ${clicks} clicks in ${cfg.windowDays} days with 0 tracked conversions. Campaign: ${r.campaign_name}.`,
          estimatedSaving: project(cost),
          action: { type: "pause_meta_ad", adId: r.ad_id },
        });
      } else if (freq >= cfg.fatigueFrequency && cost >= cfg.fatigueMinCost) {
        findings.push({
          kind: "ad_fatigue",
          title: `Creative fatigue on ${label}`,
          rationale: `Average frequency ${freq.toFixed(1)} (people have seen this ad ${freq.toFixed(1)}x). Refresh the creative or widen the audience. Spend ${money(cost)}.`,
          estimatedSaving: project(cost) * 0.15,
          action: null,
        });
      } else if (
        impressions >= cfg.lowCtrMinImpressions &&
        ctr < cfg.lowCtrPercent &&
        cost >= cfg.lowCtrMinCost
      ) {
        findings.push({
          kind: "low_ctr_ad",
          title: `Low CTR (${ctr.toFixed(2)}%) on ${label}`,
          rationale: `${impressions.toLocaleString()} impressions at ${ctr.toFixed(2)}% CTR, spend ${money(cost)}. The creative or hook is not earning clicks.`,
          estimatedSaving: project(cost) * 0.2,
          action: null,
        });
      }
    }
    return findings.sort((a, b) => b.estimatedSaving - a.estimatedSaving);
  }

  async execute(action: ActionSpec): Promise<string> {
    if (action.type !== "pause_meta_ad") throw new Error("Not a Meta Ads action");
    await this.graph(action.adId, { status: "PAUSED" }, "POST");
    return `Paused Meta ad ${action.adId}`;
  }
}
