// Local MCP server for Claude Desktop / Claude Code:  npm run mcp
// Reads the same database as the web app, so run it from this folder.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../lib/mcp/server";

createMcpServer()
  .connect(new StdioServerTransport())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
