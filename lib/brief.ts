import { isAdPlatform, listConnections } from "@/lib/connections";
import { getLatestOverlay, insightsFor, type OverlaySnapshot } from "@/lib/overlay";
import { getLatestProfit, type ProfitSnapshot } from "@/lib/profit";
import { listAudits, listRecommendations } from "@/lib/queries";
import { getThresholds, type OverlayConfig } from "@/lib/thresholds";


export type Status = "good" | "watch" | "problem" | "unknown";

export interface BriefAction {
  title: string;
  why: string;
  moneyPerMonth: number | null;
  recommendationId?: number;
  canApply: boolean; // true = Approve/Deny buttons apply
}

export interface SetupStep {
  label: string;
  detail: string;
  done: boolean;
  href: string;
}

export interface Brief {
  setup: SetupStep[];
  setupComplete: boolean;
  status: Status;
  headline: string;
  subline: string;
  currency: string;
  windowDays: number;
  numbers: {
    sales: number;
    adSpend: number;
    productCosts: number | null;
    otherCosts: number;
    profit: number | null;
    marginPercent: number | null;
    salesPerAdPound: number | null;
    costPerNewCustomer: number | null;
  } | null;
  actions: BriefAction[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

interface RecRow {
  id: number;
  title: string;
  rationale: string;
  estimated_saving: number;
  actionable: boolean;
}

/** Pure: everything the home screen says, from the stored snapshots. */
export function buildBrief(input: {
  overlay: OverlaySnapshot | null;
  profit: ProfitSnapshot | null;
  recs: RecRow[];
  cfg: OverlayConfig;
  connected: { shopify: boolean; ads: boolean };
  hasAudit: boolean;
}): Brief {
  const { overlay, profit, recs, cfg, connected, hasAudit } = input;
  const missing = profit?.productsMissingCost ?? 0;
  const costsKnown = !!profit && profit.costRatio !== null;

  const setup: SetupStep[] = [
    { label: "Connect Shopify", detail: "So we can see your real sales.", done: connected.shopify, href: "/connect" },
    { label: "Connect an ad account", detail: "Google Ads or Meta Ads.", done: connected.ads, href: "/connect" },
    {
      label: "Product costs",
      detail: !connected.shopify
        ? "Pulled from Shopify automatically."
        : !profit
          ? "Reading your products…"
          : costsKnown
            ? missing > 0 ? `${missing} product${missing > 1 ? "s" : ""} still have no cost in Shopify.` : "All set."
            : `Add what products cost you in Shopify (${missing} missing).`,
      done: costsKnown,
      href: "/connect",
    },
    { label: "First ad check", detail: "Finds wasted ad spend.", done: hasAudit, href: "/" },
  ];
  const setupComplete = setup.every((s) => s.done);

  const base = { setup, setupComplete, actions: [] as BriefAction[] };
  if (!overlay) {
    return {
      ...base, status: "unknown", currency: "GBP", windowDays: cfg.windowDays, numbers: null,
      headline: "Let's set you up",
      subline: "Connect your shop and your ads and this page will tell you, in one line, whether you're making money.",
    };
  }

  const currency = overlay.shop.currency;
  const sales = overlay.shop.netRevenue;
  const adSpend = overlay.totals.adSpend;
  const otherCosts = r2(sales * (cfg.otherCostsPercent / 100));
  const productCosts = costsKnown ? r2(sales * profit!.costRatio!) : null;
  const profitAmt = productCosts !== null ? r2(sales - productCosts - otherCosts - adSpend) : null;
  const margin = profitAmt !== null && sales > 0 ? r2((profitAmt / sales) * 100) : null;
  const warnings = insightsFor(overlay, cfg).filter((i) => i.level === "warn");

  let status: Status = "unknown";
  let headline: string;
  let subline: string;
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.abs(n));

  if (profitAmt === null) {
    headline = "We can't see your profit yet";
    subline = `Your product costs aren't in Shopify, so we can't work out what you keep. Sales were ${fmt(sales)} and ad spend ${fmt(adSpend)} over the last ${overlay.windowDays} days.`;
  } else if (profitAmt < 0) {
    status = "problem";
    headline = `You're losing about ${fmt(profitAmt)}`;
    subline = `Over the last ${overlay.windowDays} days, after product costs and ads, you spent more than you kept.`;
  } else {
    status = warnings.length ? "watch" : "good";
    headline = `You made about ${fmt(profitAmt)}`;
    subline = `Over the last ${overlay.windowDays} days, after product costs and ads${
      cfg.otherCostsPercent ? " and other costs" : " (before shipping and fees)"
    }.${warnings.length ? " A few things are worth a look." : ""}`;
  }

  // ---- candidate actions ----
  const cand: (BriefAction & { rank: number })[] = [];
  if (!costsKnown && connected.shopify) {
    cand.push({
      title: "Add your product costs in Shopify",
      why: "Without them we can't tell profit from sales. In Shopify open a product, then the variant, and fill in 'Cost per item'.",
      moneyPerMonth: null, canApply: false, rank: 1e12,
    });
  } else if (missing > 0) {
    cand.push({
      title: `Add costs for ${missing} more product${missing > 1 ? "s" : ""}`,
      why: "Profit is estimated from the products that do have a cost. Filling in the rest makes it exact.",
      moneyPerMonth: null, canApply: false, rank: 1,
    });
  }
  for (const r of recs) {
    cand.push({
      title: r.title, why: r.rationale,
      moneyPerMonth: r.estimated_saving > 0 ? r2(r.estimated_saving) : null,
      recommendationId: r.id, canApply: r.actionable,
      rank: r.estimated_saving + (r.actionable ? 0.5 : 0),
    });
  }
  for (const p of profit?.products ?? []) {
    if (p.profit !== null && p.profit < 0 && sales > 0 && p.revenue / sales >= 0.02) {
      const loss = Math.abs(p.profit) * (30 / (profit?.windowDays ?? 30));
      cand.push({
        title: `"${p.title}" sells at a loss`,
        why: `It brought in ${fmt(p.revenue)} but cost ${fmt(p.cost)} to make or buy. Raise the price, or stop promoting it.`,
        moneyPerMonth: r2(loss), canApply: false, rank: loss,
      });
    }
  }
  if (overlay.totals.attributionRatio != null && overlay.totals.attributionRatio > cfg.maxAttributionGap) {
    cand.push({
      title: "Don't trust Meta's and Google's own sales numbers",
      why: `Together they claim ${Math.round(overlay.totals.attributionRatio * 100)}% of the sales Shopify recorded. Judge your ads by your Shopify sales instead.`,
      moneyPerMonth: null, canApply: false, rank: 0.8,
    });
  }
  const actions = cand.sort((a, b) => b.rank - a.rank).slice(0, 3).map((c) => {
    const { rank, ...a } = c; void rank; return a;
  });

  return {
    setup, setupComplete, status, headline, subline, currency, windowDays: overlay.windowDays,
    numbers: {
      sales, adSpend, productCosts, otherCosts, profit: profitAmt, marginPercent: margin,
      salesPerAdPound: overlay.totals.mer, costPerNewCustomer: overlay.totals.blendedCac,
    },
    actions,
  };
}

export async function getBrief(tenantId: string): Promise<Brief> {
  const [connections, overlay, profit, pending, audits, thresholds] = await Promise.all([
    listConnections(tenantId),
    getLatestOverlay(tenantId),
    getLatestProfit(tenantId),
    listRecommendations(tenantId, { status: "pending" }),
    listAudits(tenantId, 20),
    getThresholds(tenantId),
  ]);
  return buildBrief({
    overlay, profit,
    recs: pending.map((r) => ({
      id: Number(r.id), title: String(r.title), rationale: String(r.rationale),
      estimated_saving: Number(r.estimated_saving), actionable: Boolean(r.action_json),
    })),
    cfg: thresholds.overlay,
    connected: {
      shopify: connections.some((c) => c.platform === "shopify"),
      ads: connections.some((c) => isAdPlatform(c.platform)),
    },
    hasAudit: audits.some((a) => !a.error),
  });
}
