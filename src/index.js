#!/usr/bin/env node
// MCP server entry point — dispatches to stdio or HTTP mode.
//
// Default (no args): stdio mode, for clients that spawn a subprocess
// (ZCode, Claude Desktop stdio config). stdout carries JSON-RPC.
//
// `--http` / `serve`: long-lived HTTP service speaking the MCP Streamable
// HTTP transport (stateless). One URL, one shared Edge session, usable by
// every MCP client on the machine. See src/http.js for details.
//
// The Edge connection is always lazy — neither mode connects until the first
// tool call, so the server starts even when Edge is not running.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { disconnect } from "./browser.js";
import { createServer, ALL_TOOLS } from "./server.js";

const mode = process.argv.includes("--http") || process.argv[2] === "serve" ? "http" : "stdio";

if (mode === "http") {
  // Hand off to the HTTP entry point (it owns the http server + lifecycle).
  await import("./http.js");
} else {
  const server = createServer();

  async function shutdown() {
    await disconnect();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[edge-mcp] stdio server ready — ${ALL_TOOLS.length} tools registered.`);
  console.error(`[edge-mcp] Edge connection is lazy; launch Edge with --remote-debugging-port=9222 before calling tools.`);
}
