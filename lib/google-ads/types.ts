export interface SearchTermStat {
  term: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  cost: number; // account currency
  clicks: number;
  impressions: number;
  conversions: number;
}

export interface KeywordStat {
  resourceName: string;
  text: string;
  matchType: string;
  qualityScore: number | null;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  cost: number;
  clicks: number;
  conversions: number;
}

export interface CampaignStat {
  campaignId: string;
  campaignName: string;
  dailyBudget: number;
  cost: number;
  conversions: number;
  lostImpressionShareBudget: number; // 0..1
}
