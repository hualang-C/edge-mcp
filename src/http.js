// HTTP transport entry point.
//
// Runs the edge-mcp server as a long-lived HTTP service speaking the MCP
// Streamable HTTP transport (stateless mode). Any MCP client on the machine
// (ZCode, Claude Desktop, Cursor, Cline, …) can point at the same URL and
// share one Edge browser session.
//
// Stateless mode: each request gets a fresh McpServer + transport (no session
// id). The only shared state is the Edge connection itself (managed in
// browser.js), which is exactly what we want to persist across requests and
// across clients.
//
// Usage:
//   node src/http.js                 # default 127.0.0.1:7123
//   PORT=8080 node src/http.js
//   HOST=0.0.0.0 node src/http.js    # expose to LAN (mind the security note)
//
// Endpoint: http://127.0.0.1:7123/mcp   (POST: JSON-RPC; GET: SSE stream)
// Health:   http://127.0.0.1:7123/health (GET: liveness probe)

import http from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { disconnect } from "./browser.js";
import { createServer, ALL_TOOLS } from "./server.js";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 7123;
const ENDPOINT = "/mcp";

/** Read and JSON-parse the request body. Returns null on missing/invalid body. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null); // present but invalid JSON
      }
    });
    req.on("error", () => resolve(null));
  });
}

/**
 * Handle a single MCP request in stateless mode: new transport + new server,
 * connect them, let the transport write the response, then close.
 */
async function handleMcpRequest(req, res, parsedBody) {
  // Stateless: no session id is generated or validated.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    const server = createServer();
    await server.connect(transport);
    // handleRequest writes the JSON-RPC response (or SSE stream) to `res`.
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    console.error("[edge-mcp] request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: err.message } }));
    }
  } finally {
    // Best-effort cleanup; transport has no session to tear down in stateless mode.
    try { await transport.close(); } catch {}
  }
}

const httpServer = http.createServer(async (req, res) => {
  // This is a resident service: a single malformed request must never
  // escalate to an unhandled rejection, which Node treats as fatal by
  // default and would kill the process for every connected client.
  try {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      // Malformed request target (e.g. invalid percent-encoding).
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Bad request" }));
      return;
    }

    // CORS: allow any local MCP client to call us. The server binds to
    // 127.0.0.1 by default, so this only affects the local machine.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, accept, mcp-session-id, last-event-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check — handy for process managers and for clients to probe.
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "edge-mcp", tools: ALL_TOOLS.length }));
      return;
    }

    if (url.pathname === ENDPOINT) {
      if (req.method === "POST") {
        const parsed = await readBody(req);
        if (!parsed) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Invalid JSON body" } }));
          return;
        }
        await handleMcpRequest(req, res, parsed);
        return;
      }
      if (req.method === "GET") {
        // GET opens an SSE stream; there is no body to parse.
        await handleMcpRequest(req, res, undefined);
        return;
      }
      // Stateless mode has no session, so DELETE (session termination in the
      // MCP spec) is not applicable.
      res.writeHead(405, { "content-type": "application/json", allow: "GET, POST" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", hint: `POST MCP JSON-RPC to ${ENDPOINT}` }));
  } catch (err) {
    console.error("[edge-mcp] unexpected request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    } else {
      res.end();
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  console.error(`[edge-mcp] HTTP server listening on http://${HOST}:${PORT}${ENDPOINT}`);
  console.error(`[edge-mcp] health: http://${HOST}:${PORT}/health`);
  console.error(`[edge-mcp] ${ALL_TOOLS.length} tools registered. Edge connection is lazy.`);
  console.error(`[edge-mcp] Launch Edge with --remote-debugging-port=9222 before calling tools.`);
});

async function shutdown() {
  console.error("[edge-mcp] shutting down...");
  httpServer.close();
  await disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
