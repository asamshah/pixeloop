import { getTenantId } from "@/lib/tenant";
import { getThresholds } from "@/lib/thresholds";
import { ThresholdsForm, type FieldDef } from "@/components/thresholds-form";

export const dynamic = "force-dynamic";

const GOOGLE: FieldDef[] = [
  { name: "windowDays", label: "Look-back window (days)", help: "7–90. Spend is projected to 30 days from this window.", step: "1" },
  { name: "minWastedTermCost", label: "Wasted search term: min spend", help: "A search term needs at least this spend with 0 conversions." },
  { name: "minWastedTermClicks", label: "Wasted search term: min clicks", help: "…and at least this many clicks.", step: "1" },
  { name: "minKeywordCost", label: "Keyword: min spend", help: "Spend before a zero-conversion keyword is flagged for pausing." },
  { name: "minKeywordClicks", label: "Keyword: min clicks", help: "Clicks before a keyword counts as proven non-converting.", step: "1" },
  { name: "lowQualityScore", label: "Low Quality Score at or below", help: "1–10. Advisory only.", step: "1" },
  { name: "budgetLostShareThreshold", label: "Budget-lost impression share", help: "0–1 (0.2 = 20%). Flags converting campaigns capped by budget." },
];

const META: FieldDef[] = [
  { name: "windowDays", label: "Look-back window (days)", help: "7–90.", step: "1" },
  { name: "minAdCost", label: "Zero-conversion ad: min spend", help: "Spend before an ad with no conversions is flagged for pausing." },
  { name: "minAdClicks", label: "Zero-conversion ad: min clicks", help: "…and at least this many clicks.", step: "1" },
  { name: "fatigueFrequency", label: "Creative fatigue frequency", help: "Average times each person saw the ad (4 is a common limit)." },
  { name: "fatigueMinCost", label: "Fatigue: min spend", help: "Ignore tiny ads." },
  { name: "lowCtrPercent", label: "Low CTR below (%)", help: "e.g. 0.5 means 0.5%." },
  { name: "lowCtrMinImpressions", label: "Low CTR: min impressions", help: "Enough volume for CTR to be meaningful.", step: "1" },
  { name: "lowCtrMinCost", label: "Low CTR: min spend", help: "Ignore tiny ads." },
];

const OVERLAY: FieldDef[] = [
  { name: "windowDays", label: "Revenue window (days)", help: "7–90. Window for Shopify revenue and ad spend.", step: "1" },
  { name: "targetMer", label: "Target blended MER", help: "Shopify net revenue ÷ total ad spend. Below this is flagged. 0 turns the check off." },
  { name: "otherCostsPercent", label: "Other costs (% of sales)", help: "Payment fees, shipping and fulfilment. Subtracted when estimating profit. 0 means ignored, which makes profit look better than it is." },
  { name: "maxAttributionGap", label: "Max platform-claimed ÷ Shopify revenue", help: "1.3 = platforms may claim up to 130% of real revenue before it is flagged as double counting." },
];

export default async function SettingsPage() {
  const t = await getThresholds(await getTenantId());
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Thresholds</h1>
        <p className="text-sm text-neutral-500">
          Amounts are in each ad account’s currency. Changes apply from the next audit; existing
          recommendations are not rewritten.
        </p>
      </header>
      <ThresholdsForm section="google_ads" title="Google Ads audit" fields={GOOGLE} values={t.google_ads as unknown as Record<string, number>} />
      <ThresholdsForm section="meta_ads" title="Meta Ads audit" fields={META} values={t.meta_ads as unknown as Record<string, number>} />
      <ThresholdsForm section="overlay" title="Shopify revenue overlay" fields={OVERLAY} values={t.overlay as unknown as Record<string, number>} />
    </main>
  );
}
