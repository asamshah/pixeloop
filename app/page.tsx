import Link from "next/link";
import { getTenantId } from "@/lib/tenant";
import { isAdPlatform, listConnections } from "@/lib/connections";
import { isDryRun } from "@/lib/actions/execute";
import { getBrief, type Status } from "@/lib/brief";
import { getLatestOverlay, insightsFor } from "@/lib/overlay";
import { getLatestProfit } from "@/lib/profit";
import { getThresholds } from "@/lib/thresholds";
import { listActionLog, listAudits, listRecommendations } from "@/lib/queries";
import { AUDIT_INTERVAL_DAYS, getPlatformSchedules, isScheduleEnabled } from "@/lib/schedule";
import { parseDbDate } from "@/lib/time";
import { PLATFORM_LABEL, type Platform } from "@/lib/platforms/types";
import { DecisionButtons, RefreshOverlayButton, RunAuditButton, ScheduleToggle } from "@/components/audit-controls";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<Status, string> = {
  good: "border-green-500 bg-green-50 text-green-950 dark:bg-green-950/30 dark:text-green-100",
  watch: "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100",
  problem: "border-red-500 bg-red-50 text-red-950 dark:bg-red-950/30 dark:text-red-100",
  unknown: "border-neutral-300 bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100",
};
const STATUS_LABEL: Record<Status, string> = {
  good: "Healthy",
  watch: "Worth a look",
  problem: "Needs attention",
  unknown: "Getting started",
};

const when = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

export default async function Home() {
  const tenantId = await getTenantId();
  const [brief, connections, overlay, profit, thresholds, allRecs, audits, actions, scheduleOn, schedules] =
    await Promise.all([
      getBrief(tenantId),
      listConnections(tenantId),
      getLatestOverlay(tenantId),
      getLatestProfit(tenantId),
      getThresholds(tenantId),
      listRecommendations(tenantId, { status: "pending" }),
      listAudits(tenantId, 10),
      listActionLog(tenantId, 10),
      isScheduleEnabled(tenantId),
      getPlatformSchedules(tenantId),
    ]);
  const adConns = connections.filter((c) => isAdPlatform(c.platform));
  const shopifyConnected = connections.some((c) => c.platform === "shopify");
  const insights = overlay ? insightsFor(overlay, thresholds.overlay) : [];
  const dry = isDryRun();
  const cur = brief.currency;
  const money = (n: number, c = cur) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: c || "GBP", maximumFractionDigits: 0 }).format(n);
  const shownIds = new Set(brief.actions.map((a) => a.recommendationId).filter((x) => x != null));
  const otherRecs = allRecs.filter((r) => !shownIds.has(Number(r.id)));

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {dry && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Safe mode: Approve only records what would change. Nothing is touched in your ad accounts.
        </p>
      )}

      {!brief.setupComplete && (
        <section className="rounded-xl border p-5">
          <h2 className="font-medium">
            Get set up ({brief.setup.filter((s) => s.done).length} of {brief.setup.length})
          </h2>
          <ol className="mt-3 space-y-3">
            {brief.setup.map((s, i) => (
              <li key={s.label} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs ${
                    s.done ? "bg-green-600 text-white" : "border text-neutral-500"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <div>
                  <p className={s.done ? "text-neutral-500 line-through" : "font-medium"}>{s.label}</p>
                  <p className="text-neutral-500">{s.detail}</p>
                  {!s.done && s.href !== "/" && (
                    <Link href={s.href} className="text-sm underline">Do this</Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {adConns.length > 0 && !brief.setup[3].done && (
            <div className="mt-4 flex flex-wrap gap-2">
              {adConns.map((c) => (
                <RunAuditButton key={c.platform} platform={c.platform as Platform} label={PLATFORM_LABEL[c.platform as Platform]} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* The one-line answer */}
      <section className={`rounded-xl border-2 p-6 ${STATUS_STYLE[brief.status]}`}>
        <p className="text-xs font-medium uppercase tracking-wide opacity-70">{STATUS_LABEL[brief.status]}</p>
        <h1 className="mt-1 text-3xl font-semibold">{brief.headline}</h1>
        <p className="mt-2 text-sm opacity-80">{brief.subline}</p>
        {brief.numbers && (
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {[
              ["Sales", money(brief.numbers.sales)],
              ["Ad spend", money(brief.numbers.adSpend)],
              ["Product costs", brief.numbers.productCosts !== null ? money(brief.numbers.productCosts) : "unknown"],
              ["Left over", brief.numbers.profit !== null ? money(brief.numbers.profit) : "unknown"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs opacity-70">{k}</dt>
                <dd className="text-lg font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {brief.numbers && (
          <p className="mt-4 text-xs opacity-70">
            Every {money(1)} of ads brings back {brief.numbers.salesPerAdPound?.toFixed(2) ?? "–"} of sales
            {brief.numbers.costPerNewCustomer != null && (
              <> · winning a new customer costs about {money(brief.numbers.costPerNewCustomer)}</>
            )}
          </p>
        )}
      </section>

      {/* The only list most people need */}
      {brief.actions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Do these first</h2>
          {brief.actions.map((a, i) => (
            <article key={i} className="flex items-start justify-between gap-4 rounded-xl border p-4">
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-black text-xs font-medium text-white dark:bg-white dark:text-black">
                  {i + 1}
                </span>
                <div className="space-y-1">
                  <h3 className="font-medium">{a.title}</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">{a.why}</p>
                  {a.moneyPerMonth != null && (
                    <p className="text-xs font-medium text-green-700 dark:text-green-400">
                      Worth about {money(a.moneyPerMonth)} a month
                    </p>
                  )}
                </div>
              </div>
              {a.recommendationId != null && (
                <DecisionButtons id={a.recommendationId} actionable={a.canApply} />
              )}
            </article>
          ))}
        </section>
      )}
      {brief.setupComplete && brief.actions.length === 0 && (
        <p className="rounded-xl border p-4 text-sm text-neutral-600 dark:text-neutral-400">
          Nothing needs your attention right now. We check again every week.
        </p>
      )}

      {/* Everything else, out of the way */}
      <div className="space-y-3 pt-2">
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            All other suggestions ({otherRecs.length})
          </summary>
          <div className="space-y-3 border-t p-4">
            {otherRecs.length === 0 && <p className="text-sm text-neutral-500">Nothing else.</p>}
            {otherRecs.map((r) => (
              <article key={String(r.id)} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">
                    <span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-normal dark:bg-neutral-800">
                      {PLATFORM_LABEL[r.platform as Platform]}
                    </span>
                    {String(r.title)}
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">{String(r.rationale)}</p>
                </div>
                <DecisionButtons id={Number(r.id)} actionable={Boolean(r.action_json)} />
              </article>
            ))}
          </div>
        </details>

        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">How the numbers add up</summary>
          <div className="space-y-4 border-t p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-neutral-500">
                {overlay
                  ? `Last ${overlay.windowDays} days · updated ${when(parseDbDate(overlay.computedAt))}`
                  : "No numbers yet"}
              </p>
              {shopifyConnected && <RefreshOverlayButton />}
            </div>
            {!shopifyConnected && (
              <p className="text-sm text-neutral-600">
                <Link href="/connect" className="underline">Connect Shopify</Link> to compare what your ad platforms
                claim against your real sales.
              </p>
            )}
            {overlay && overlay.platforms.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500">
                    <th className="py-1 font-normal">Ad platform</th>
                    <th className="font-normal">Spent</th>
                    <th className="font-normal">Says it sold</th>
                    <th className="font-normal">Sales per {money(1)}</th>
                  </tr>
                </thead>
                <tbody>
                  {overlay.platforms.map((p) => (
                    <tr key={p.platform} className="border-t">
                      <td className="py-1">{PLATFORM_LABEL[p.platform]}</td>
                      <td>{p.error ? "error" : money(p.spend, p.currency)}</td>
                      <td>{p.error ? "–" : money(p.reportedRevenue, p.currency)}</td>
                      <td>{p.reportedRoas?.toFixed(2) ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ul className="space-y-1 text-sm">
              {insights.map((i, n) => (
                <li key={n} className={i.level === "warn" ? "text-amber-700 dark:text-amber-400" : "text-neutral-600"}>
                  {i.level === "warn" ? "⚠ " : "• "}
                  {i.text}
                </li>
              ))}
            </ul>
          </div>
        </details>

        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Product profit</summary>
          <div className="space-y-3 border-t p-4">
            {!profit && (
              <p className="text-sm text-neutral-500">
                Not calculated yet. {shopifyConnected ? "Click “Refresh numbers” above." : "Connect Shopify first."}
              </p>
            )}
            {profit && (
              <>
                <p className="text-xs text-neutral-500">
                  {profit.truncated ? `Your ${profit.ordersScanned} most recent orders` : `${profit.ordersScanned} orders`}
                  {" · "}costs known for {Math.round(profit.costCoverage * 100)}% of sales. Before returns, shipping and fees.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-neutral-500">
                      <th className="py-1 font-normal">Product</th>
                      <th className="font-normal">Sold</th>
                      <th className="font-normal">Sales</th>
                      <th className="font-normal">Kept</th>
                      <th className="font-normal">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profit.products.slice(0, 15).map((p) => (
                      <tr key={p.title} className="border-t">
                        <td className="py-1 pr-2">{p.title}</td>
                        <td>{p.units}</td>
                        <td>{money(p.revenue, profit.currency)}</td>
                        <td className={p.profit !== null && p.profit < 0 ? "text-red-600" : ""}>
                          {p.profit !== null ? money(p.profit, profit.currency) : "no cost"}
                        </td>
                        <td>{p.marginPercent !== null ? `${p.marginPercent}%` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </details>

        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Weekly checks and history</summary>
          <div className="space-y-4 border-t p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">We re-check your ads every {AUDIT_INTERVAL_DAYS} days.</p>
              <ScheduleToggle enabled={scheduleOn} />
            </div>
            <ul className="space-y-1 text-sm">
              {schedules.map((s) => (
                <li key={s.platform} className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{PLATFORM_LABEL[s.platform as Platform]}</span>
                  <span className="text-neutral-600 dark:text-neutral-400">
                    Last: {s.lastRunAt ? when(s.lastRunAt) : "never"}
                    {s.lastFailed && <span className="text-red-600"> (failed)</span>}
                    {" · "}Next: {!scheduleOn ? "paused" : s.due ? "due now" : when(s.nextRunAt)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {adConns.map((c) => (
                <RunAuditButton key={c.platform} platform={c.platform as Platform} label={PLATFORM_LABEL[c.platform as Platform]} />
              ))}
            </div>
            <ul className="divide-y rounded-lg border text-sm">
              {audits.map((a) => (
                <li key={String(a.id)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {when(parseDbDate(String(a.created_at)))} · {PLATFORM_LABEL[a.platform as Platform]}
                    <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                      {String(a.trigger)}
                    </span>
                  </span>
                  {a.error ? (
                    <span className="text-red-600">Failed: {String(a.error)}</span>
                  ) : (
                    <span className="text-neutral-600 dark:text-neutral-400">{Number(a.finding_count)} findings</span>
                  )}
                </li>
              ))}
            </ul>
            {actions.length > 0 && (
              <ul className="space-y-1 text-sm">
                {actions.map((a) => (
                  <li key={String(a.id)} className="text-neutral-600 dark:text-neutral-400">
                    {when(parseDbDate(String(a.created_at)))} · {a.ok ? "OK" : "FAILED"}
                    {a.dry_run ? " (safe mode)" : ""} · {String(a.message)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>
    </main>
  );
}
