import { GoogleAdsApi, enums, type Customer } from "google-ads-api";
import type {
  ActionSpec,
  AdPlatform,
  Finding,
  GoogleAdsCredentials,
  SpendSummary,
} from "@/lib/platforms/types";
import type {
  CampaignStat,
  KeywordStat,
  SearchTermStat,
} from "@/lib/google-ads/types";
import { analyse, DEFAULT_CONFIG, type AuditConfig } from "@/lib/audits/wasted-spend";

const micros = (n: unknown) => Number(n ?? 0) / 1_000_000;
const num = (n: unknown) => Number(n ?? 0);

// GAQL has no "LAST_N_DAYS" for arbitrary N, so use explicit dates.
function dateRange(days: number) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  return `segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'`;
}

export class GoogleAdsPlatform implements AdPlatform {
  platform = "google_ads" as const;
  private customer: Customer;
  private customerId: string;

  windowDays: number;

  constructor(
    creds: GoogleAdsCredentials,
    private cfg: AuditConfig = DEFAULT_CONFIG,
  ) {
    this.windowDays = cfg.windowDays;
    const api = new GoogleAdsApi({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      developer_token: creds.developerToken,
    });
    this.customerId = creds.customerId;
    this.customer = api.Customer({
      customer_id: creds.customerId,
      refresh_token: creds.refreshToken,
      login_customer_id: creds.loginCustomerId || undefined,
    });
  }

  async testConnection(): Promise<string> {
    const rows = await this.customer.query(
      `SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1`,
    );
    const c = rows[0]?.customer;
    return `${c?.descriptive_name ?? this.customerId} (${c?.currency_code ?? "?"})`;
  }

  async audit(): Promise<Finding[]> {
    const days = this.cfg.windowDays;
    const [terms, keywords, campaigns] = await Promise.all([
      this.fetchSearchTerms(days),
      this.fetchKeywords(days),
      this.fetchCampaigns(days),
    ]);
    return analyse(terms, keywords, campaigns, this.cfg);
  }

  async fetchSpend(days: number): Promise<SpendSummary> {
    const rows = await this.customer.query(`
      SELECT customer.currency_code, metrics.cost_micros,
             metrics.conversions_value, metrics.conversions
      FROM customer
      WHERE ${dateRange(days)}
    `);
    let spend = 0, value = 0, conv = 0;
    for (const r of rows) {
      spend += micros(r.metrics?.cost_micros);
      value += num(r.metrics?.conversions_value);
      conv += num(r.metrics?.conversions);
    }
    return {
      spend,
      currency: String(rows[0]?.customer?.currency_code ?? ""),
      reportedConversionValue: value,
      reportedConversions: conv,
    };
  }

  async fetchSearchTerms(days: number): Promise<SearchTermStat[]> {
    const rows = await this.customer.query(`
      SELECT search_term_view.search_term, campaign.id, campaign.name, ad_group.id,
             metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM search_term_view
      WHERE ${dateRange(days)} AND metrics.cost_micros > 0
    `);
    // The same term can appear once per ad group/day bucket: aggregate it.
    const agg = new Map<string, SearchTermStat>();
    for (const r of rows) {
      const key = `${r.campaign?.id}|${r.search_term_view?.search_term}`;
      const cur = agg.get(key) ?? {
        term: String(r.search_term_view?.search_term ?? ""),
        campaignId: String(r.campaign?.id ?? ""),
        campaignName: String(r.campaign?.name ?? ""),
        adGroupId: String(r.ad_group?.id ?? ""),
        cost: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      };
      cur.cost += micros(r.metrics?.cost_micros);
      cur.clicks += num(r.metrics?.clicks);
      cur.impressions += num(r.metrics?.impressions);
      cur.conversions += num(r.metrics?.conversions);
      agg.set(key, cur);
    }
    return [...agg.values()];
  }

  async fetchKeywords(days: number): Promise<KeywordStat[]> {
    const rows = await this.customer.query(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type,
             ad_group_criterion.quality_info.quality_score,
             campaign.id, campaign.name, ad_group.id,
             metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM keyword_view
      WHERE ${dateRange(days)}
        AND ad_group_criterion.status = 'ENABLED'
        AND ad_group_criterion.negative = FALSE
        AND campaign.status = 'ENABLED'
    `);
    const agg = new Map<string, KeywordStat>();
    for (const r of rows) {
      const key = String(r.ad_group_criterion?.resource_name);
      const qs = r.ad_group_criterion?.quality_info?.quality_score;
      const cur = agg.get(key) ?? {
        resourceName: key,
        text: String(r.ad_group_criterion?.keyword?.text ?? ""),
        matchType: String(
          enums.KeywordMatchType[
            r.ad_group_criterion?.keyword?.match_type as number
          ] ?? "",
        ),
        qualityScore: qs == null ? null : Number(qs),
        campaignId: String(r.campaign?.id ?? ""),
        campaignName: String(r.campaign?.name ?? ""),
        adGroupId: String(r.ad_group?.id ?? ""),
        cost: 0,
        clicks: 0,
        conversions: 0,
      };
      cur.cost += micros(r.metrics?.cost_micros);
      cur.clicks += num(r.metrics?.clicks);
      cur.conversions += num(r.metrics?.conversions);
      agg.set(key, cur);
    }
    return [...agg.values()];
  }

  async fetchCampaigns(days: number): Promise<CampaignStat[]> {
    const rows = await this.customer.query(`
      SELECT campaign.id, campaign.name, campaign_budget.amount_micros,
             metrics.cost_micros, metrics.conversions,
             metrics.search_budget_lost_impression_share
      FROM campaign
      WHERE ${dateRange(days)}
        AND campaign.status = 'ENABLED'
        AND campaign.advertising_channel_type = 'SEARCH'
    `);
    const agg = new Map<string, CampaignStat>();
    for (const r of rows) {
      const id = String(r.campaign?.id);
      const cur = agg.get(id) ?? {
        campaignId: id,
        campaignName: String(r.campaign?.name ?? ""),
        dailyBudget: micros(r.campaign_budget?.amount_micros),
        cost: 0,
        conversions: 0,
        lostImpressionShareBudget: 0,
      };
      cur.cost += micros(r.metrics?.cost_micros);
      cur.conversions += num(r.metrics?.conversions);
      // Daily rows: keep the worst (highest) value seen as a conservative signal.
      cur.lostImpressionShareBudget = Math.max(
        cur.lostImpressionShareBudget,
        num(r.metrics?.search_budget_lost_impression_share),
      );
      agg.set(id, cur);
    }
    return [...agg.values()];
  }

  async execute(action: ActionSpec): Promise<string> {
    const cid = this.customerId;
    switch (action.type) {
      case "add_negative_keyword": {
        await this.customer.campaignCriteria.create([
          {
            campaign: `customers/${cid}/campaigns/${action.campaignId}`,
            negative: true,
            keyword: {
              text: action.text,
              match_type:
                action.matchType === "EXACT"
                  ? enums.KeywordMatchType.EXACT
                  : enums.KeywordMatchType.PHRASE,
            },
          },
        ]);
        return `Added ${action.matchType} negative "${action.text}" to campaign ${action.campaignId}`;
      }
      case "pause_meta_ad":
        throw new Error("Not a Google Ads action");
      case "pause_keyword": {
        await this.customer.adGroupCriteria.update([
          {
            resource_name: action.resourceName,
            status: enums.AdGroupCriterionStatus.PAUSED,
          },
        ]);
        return `Paused keyword ${action.resourceName}`;
      }
    }
  }
}
