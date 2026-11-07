import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";

export const maxDuration = 120;

// Remote MCP endpoint (streamable HTTP, stateless). Disabled unless MCP_API_KEY
// is set. Add it in Claude as a custom connector:
//   URL:    https://<your-host>/api/mcp
//   Header: Authorization: Bearer <MCP_API_KEY>
function authorised(req: Request) {
  const key = process.env.MCP_API_KEY;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return (
    !!key &&
    given.length === key.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(key))
  );
}

async function handle(req: Request) {
  if (!process.env.MCP_API_KEY) {
    return new Response("MCP endpoint disabled: set MCP_API_KEY", { status: 503 });
  }
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await createMcpServer().connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
