# Ads Agent

Wasted-spend audits for **Google Ads** and **Meta Ads** with an approve/deny queue,
a **Shopify revenue overlay**, per-tenant thresholds, a weekly scheduled audit, and an MCP server. Single-tenant trial build (no user auth
or billing yet); every table already carries `tenant_id` and `lib/tenant.ts` is the
one seam to change when auth is added.

## Run
Requires **Node 22** (`nvm use`). Next 16 returns 500 on Node 27 alpha.

```bash
cp env.example .env.local
npm install
npm run dev
```

1. Open `/connect` and add credentials. They are tested against the real API, then
   stored AES-256-GCM encrypted. They are never returned to the browser.
2. Click **Audit** on the dashboard. Approve/deny recommendations.
3. `ADS_DRY_RUN=true` (default) means approvals are only logged. Set `false` to go live.

For `next start` / deployed use you must set `ENCRYPTION_KEY`, and should set `APP_PASSWORD`.

## Shopify revenue overlay
Connect Shopify at `/connect` (custom app with `read_orders`, `read_products`, `read_inventory`;
add `read_all_orders` for history past 60 days). Read-only: nothing is ever written to Shopify. The dashboard then shows, for the
configured window (default 30 days): net revenue (after discounts and refunds, ex tax/shipping),
ad spend, **MER** (revenue / ad spend), **blended CAC**, new customers, AOV, and what each ad
platform *claims* it drove, with flags when:
- MER is below your target, or
- platforms together claim more revenue than Shopify recorded (double counting).

Refreshes on connect, via the Refresh button, daily from the scheduler, and via the MCP
`get_revenue_overlay` tool. Spend is never summed across currencies (mismatches are flagged).
"New customer" is approximated from `customer.createdAt` vs order time; refine before relying on CAC.

## Simple by design
The home screen answers three questions and hides the rest:
1. **Am I making money?** One verdict (healthy / worth a look / needs attention) and one line:
   estimated profit = sales − product costs − ad spend − your "other costs %".
2. **What should I do?** At most 3 actions, ranked by money, in plain English, with Approve/Deny
   inline. Mixes ad fixes, loss-making products, missing costs and over-claiming ad platforms.
3. **Am I set up?** A 4-step checklist for new brands (Shopify → ads → costs → first check).

Everything else (suggestions, how the numbers add up, product profit, schedule, history) is in
collapsed sections. No jargon on the main screen. Logic lives in `lib/brief.ts` (pure, testable).

Product costs come **from Shopify's own "Cost per item"**, so nobody re-enters them. Profit uses
the cost ratio of products whose cost is known (needs ≥50% of sales covered, otherwise the app
says it can't tell and asks for costs). Reads the ~1,500 most recent orders per refresh, with
rate-limit handling. Not included: returns, shipping and fees (set "Other costs %" to approximate).
MCP: start with `get_brief`; `get_product_profit` for the table.

## Thresholds
`/settings` edits every audit and overlay threshold per tenant (validated, strict keys, reset to
defaults per section). Stored as overrides on top of defaults, so new defaults ship automatically.
Also available over MCP (`get_thresholds`, `update_thresholds`). Applies from the next audit.

## Weekly audit
Every connected platform is audited every 7 days (a manual run resets the clock; a
failed run retries after 6h). Results appear on the dashboard: schedule card, latest
summary, audit history, and new pending recommendations. Pause it with the toggle.

- Self-hosted (`next start`): runs in-process, checks every 15 minutes.
- Serverless: set `DISABLE_SCHEDULER=true`, `CRON_SECRET`, and call
  `GET /api/cron/audit` (header `Authorization: Bearer $CRON_SECRET`) daily or hourly.
  It only runs audits that are due.

## MCP server
Tools: `list_connections`, `run_audit`, `get_audits`, `list_recommendations`,
`approve_recommendation`, `reject_recommendation`, `get_schedule`, `get_revenue_overlay`,
`get_thresholds`, `update_thresholds`. Credentials are never exposed.
`approve_recommendation` honours `ADS_DRY_RUN` and is flagged destructive so clients ask first.

- **Remote** (Claude custom connector): set `MCP_API_KEY`, then URL `https://<host>/api/mcp`
  with header `Authorization: Bearer <MCP_API_KEY>`.
- **Local** (Claude Desktop / Claude Code): `claude mcp add ads-agent -- npx tsx mcp/stdio.ts`
  run from this folder (same DB and `ENCRYPTION_KEY` as the app).

## Layout
- `lib/platforms/types.ts` – `AdPlatform` interface, shared `Finding`/`ActionSpec`
- `lib/google-ads/`, `lib/meta-ads/` – connectors (GAQL / Graph API) and their audit rules
- `lib/audits/wasted-spend.ts` – Google rules + thresholds; Meta thresholds in `lib/meta-ads/client.ts`
- `lib/connections.ts`, `lib/crypto.ts` – credential validation + encrypted storage
- `lib/shopify/client.ts`, `lib/overlay.ts` – Shopify sales sync, MER/CAC overlay, insights
- `lib/brief.ts`, `lib/profit.ts` – the simple home-screen logic and product profit
- `lib/thresholds.ts` – per-tenant threshold schema, defaults and storage
- `lib/audit-service.ts`, `lib/schedule.ts` – audit runner, weekly scheduler (`instrumentation.ts` starts it)
- `lib/actions/execute.ts` – validated, dry-run-gated executor + action log
- `lib/mcp/server.ts` – tool definitions (`app/api/mcp`, `mcp/stdio.ts`)
- `proxy.ts` – optional `APP_PASSWORD` gate

## Meta notes
Token needs `ads_read` + `ads_management`. Prefer a System User token (does not expire).
Conversions counted: purchase, lead, complete_registration (edit `CONVERSION_ACTIONS`).

## Next
Bulk order sync for exact (not sampled) profit, returns/shipping/fees, cohorts and LTV, real auth + billing, OAuth "Connect with Google/Meta"
buttons (replaces pasting tokens), more platforms.
