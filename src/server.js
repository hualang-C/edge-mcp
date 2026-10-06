// Shared server factory: builds a McpServer with every Edge tool registered.
// Both the stdio entry (index.js) and the HTTP entry (http.js) use this so
// there is a single place that lists the tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { navigationTools } from "./tools/navigation.js";
import { interactionTools } from "./tools/interaction.js";
import { readTools } from "./tools/read.js";
import { tabTools } from "./tools/tabs.js";

export const ALL_TOOLS = [...navigationTools, ...interactionTools, ...readTools, ...tabTools];

/**
 * Build a fresh McpServer with all tools registered.
 * In HTTP stateless mode this is called per request (cheap — just map
 * population). The expensive Edge CDP connection is shared via browser.js.
 */
export function createServer() {
  const server = new McpServer({ name: "edge-mcp", version: "1.0.0" });
  for (const tool of ALL_TOOLS) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.handler);
  }
  return server;
}
