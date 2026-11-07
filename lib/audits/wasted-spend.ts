import type { Finding } from "@/lib/platforms/types";
import type {
  CampaignStat,
  KeywordStat,
  SearchTermStat,
} from "@/lib/google-ads/types";

// Thresholds are in account currency. Tune per tenant later.
export interface AuditConfig {
  windowDays: number;
  minWastedTermCost: number;
  minWastedTermClicks: number;
  minKeywordCost: number;
  minKeywordClicks: number;
  lowQualityScore: number;
  budgetLostShareThreshold: number;
}

export const DEFAULT_CONFIG: AuditConfig = {
  windowDays: 30,
  minWastedTermCost: 20,
  minWastedTermClicks: 10,
  minKeywordCost: 40,
  minKeywordClicks: 20,
  lowQualityScore: 4,
  budgetLostShareThreshold: 0.2,
};

const money = (n: number) => n.toFixed(2);
// Scale spend observed over the window to a 30-day projection.
const project = (cost: number, days: number) => (cost / days) * 30;

export function analyse(
  terms: SearchTermStat[],
  keywords: KeywordStat[],
  campaigns: CampaignStat[],
  cfg: AuditConfig = DEFAULT_CONFIG,
): Finding[] {
  const findings: Finding[] = [];

  for (const t of terms) {
    if (
      t.conversions === 0 &&
      t.cost >= cfg.minWastedTermCost &&
      t.clicks >= cfg.minWastedTermClicks
    ) {
      findings.push({
        kind: "wasted_search_term",
        title: `Negative "${t.term}" in ${t.campaignName}`,
        rationale: `Spent ${money(t.cost)} over ${t.clicks} clicks in ${cfg.windowDays} days with 0 conversions.`,
        estimatedSaving: project(t.cost, cfg.windowDays),
        action: {
          type: "add_negative_keyword",
          campaignId: t.campaignId,
          text: t.term,
          matchType: "EXACT",
        },
      });
    }
  }

  for (const k of keywords) {
    const zeroConv =
      k.conversions === 0 &&
      k.cost >= cfg.minKeywordCost &&
      k.clicks >= cfg.minKeywordClicks;
    const lowQs =
      k.qualityScore != null &&
      k.qualityScore <= cfg.lowQualityScore &&
      k.cost >= cfg.minKeywordCost / 2;

    if (zeroConv) {
      findings.push({
        kind: "zero_conversion_keyword",
        title: `Pause "${k.text}" (${k.matchType}) in ${k.campaignName}`,
        rationale: `Spent ${money(k.cost)} over ${k.clicks} clicks with 0 conversions${
          k.qualityScore != null ? ` (Quality Score ${k.qualityScore})` : ""
        }.`,
        estimatedSaving: project(k.cost, cfg.windowDays),
        action: { type: "pause_keyword", resourceName: k.resourceName },
      });
    } else if (lowQs) {
      // Advisory: low QS alone is a fix-the-ad/landing-page problem, not a pause.
      findings.push({
        kind: "low_quality_score",
        title: `Low Quality Score (${k.qualityScore}) on "${k.text}" in ${k.campaignName}`,
        rationale: `Spent ${money(k.cost)} at QS ${k.qualityScore}. Improve ad relevance / landing page, or tighten match type. Low QS raises CPC.`,
        estimatedSaving: project(k.cost, cfg.windowDays) * 0.2, // rough CPC uplift
        action: null,
      });
    }
  }

  for (const c of campaigns) {
    if (
      c.lostImpressionShareBudget >= cfg.budgetLostShareThreshold &&
      c.conversions > 0
    ) {
      findings.push({
        kind: "budget_capped",
        title: `${c.campaignName} is losing impressions to budget`,
        rationale: `Up to ${(c.lostImpressionShareBudget * 100).toFixed(0)}% impression share lost to budget on a converting campaign (daily budget ${money(c.dailyBudget)}). Consider shifting budget from wasteful campaigns.`,
        estimatedSaving: 0,
        action: null,
      });
    }
  }

  return findings.sort((a, b) => b.estimatedSaving - a.estimatedSaving);
}
