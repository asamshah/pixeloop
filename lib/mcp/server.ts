import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTenantId } from "@/lib/tenant";
import { listConnections } from "@/lib/connections";
import { runAuditFor } from "@/lib/audit-service";
import {
  approveRecommendation,
  isDryRun,
  rejectRecommendation,
} from "@/lib/actions/execute";
import { listAudits, listRecommendations } from "@/lib/queries";
import {
  getPlatformSchedules,
  isScheduleEnabled,
  AUDIT_INTERVAL_DAYS,
} from "@/lib/schedule";
import { getThresholds, ThresholdSchema, updateThresholds } from "@/lib/thresholds";
import { hasShopify } from "@/lib/connections";
import { insightsFor, refreshOverlay, refreshOverlayIfStale } from "@/lib/overlay";
import { getBrief } from "@/lib/brief";
import { refreshProfit, refreshProfitIfStale } from "@/lib/profit";
import { PLATFORMS, type Platform } from "@/lib/platforms/types";

const platformEnum = z.enum(PLATFORMS as [Platform, ...Platform[]]);

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
});

// Same tools over stdio (local) and HTTP (/api/mcp, remote connector).
export function createMcpServer() {
  const server = new McpServer({ name: "ads-agent", version: "0.1.0" });

  server.registerTool(
    "list_connections",
    {
      description: "List the ad platforms connected to this workspace. Never returns credentials.",
      annotations: { readOnlyHint: true },
    },
    async () => json(await listConnections(await getTenantId())),
  );

  server.registerTool(
    "run_audit",
    {
      description:
        "Run a fresh wasted-spend audit on a connected ad platform and create recommendations. Read-only against the ad account.",
      inputSchema: { platform: platformEnum },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ platform }) => {
      try {
        return json(await runAuditFor(await getTenantId(), platform, "mcp"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_audits",
    {
      description: "Recent audit runs (manual, scheduled and MCP) with projected monthly waste and any errors.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => json(await listAudits(await getTenantId(), limit)),
  );

  server.registerTool(
    "list_recommendations",
    {
      description:
        "List recommendations, biggest saving first. Defaults to pending. Actionable ones have an action_json; the rest are advisory.",
      inputSchema: {
        status: z.string().default("pending").describe("pending, approved_dry_run, executed, rejected, failed, superseded"),
        platform: platformEnum.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status, platform }) =>
      json(await listRecommendations(await getTenantId(), { status, platform })),
  );

  server.registerTool(
    "approve_recommendation",
    {
      description: `Approve a pending recommendation and execute its change on the ad account (pause an ad/keyword, add a negative keyword). Currently ${
        isDryRun() ? "in DRY-RUN mode: it only logs" : "LIVE: it changes the real account"
      }. Only call after the user has explicitly agreed to this specific change.`,
      inputSchema: { id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        return json(await approveRecommendation(await getTenantId(), id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "reject_recommendation",
    {
      description: "Dismiss a pending recommendation without changing anything.",
      inputSchema: { id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id }) => {
      await rejectRecommendation(await getTenantId(), id);
      return json({ ok: true });
    },
  );

  server.registerTool(
    "get_schedule",
    {
      description: `Weekly audit schedule (every ${AUDIT_INTERVAL_DAYS} days): whether it is on and when each platform runs next.`,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const tenantId = await getTenantId();
      return json({
        enabled: await isScheduleEnabled(tenantId),
        platforms: await getPlatformSchedules(tenantId),
      });
    },
  );

  server.registerTool(
    "get_brief",
    {
      description:
        "START HERE. The plain-English state of the business: a verdict (good/watch/problem), estimated profit after product costs and ads, and the top 3 things to do, ranked by money. Use this to answer 'how am I doing?' or 'what should I do?'. Actions with canApply=true can be applied with approve_recommendation (after the user agrees).",
      annotations: { readOnlyHint: true },
    },
    async () => json(await getBrief(await getTenantId())),
  );

  server.registerTool(
    "get_product_profit",
    {
      description:
        "Top-selling products with revenue, cost (from Shopify's cost-per-item), profit and margin. Products without a cost in Shopify are listed with profit null. Recomputes if older than 24 hours or refresh=true (can take a minute on large stores).",
      inputSchema: { refresh: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ refresh }) => {
      try {
        const tenantId = await getTenantId();
        if (!(await hasShopify(tenantId))) throw new Error("Shopify is not connected");
        return json(
          refresh ? await refreshProfit(tenantId) : await refreshProfitIfStale(tenantId, 24),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_revenue_overlay",
    {
      description:
        "Shopify revenue vs ad spend: net revenue, blended MER (revenue / ad spend), blended CAC, new customers, AOV, and what each ad platform CLAIMS it drove, with plain-English flags (e.g. platforms double-counting sales). Recomputes if the snapshot is older than 6 hours, or when refresh=true. Requires Shopify to be connected.",
      inputSchema: { refresh: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ refresh }) => {
      try {
        const tenantId = await getTenantId();
        if (!(await hasShopify(tenantId))) throw new Error("Shopify is not connected");
        const snapshot = refresh
          ? await refreshOverlay(tenantId)
          : await refreshOverlayIfStale(tenantId, 6);
        const cfg = (await getThresholds(tenantId)).overlay;
        return json({ snapshot, insights: insightsFor(snapshot, cfg) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_thresholds",
    {
      description:
        "The audit and overlay thresholds in effect for this workspace (defaults merged with overrides). Amounts are in account currency.",
      annotations: { readOnlyHint: true },
    },
    async () => json(await getThresholds(await getTenantId())),
  );

  server.registerTool(
    "update_thresholds",
    {
      description:
        "Change audit/overlay thresholds. Pass only the values to change, grouped by section (google_ads, meta_ads, overlay). Takes effect on the next audit. Does not touch the ad accounts.",
      inputSchema: { patch: ThresholdSchema },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ patch }) => {
      const tenantId = await getTenantId();
      await updateThresholds(tenantId, patch);
      return json(await getThresholds(tenantId));
    },
  );

  return server;
}
