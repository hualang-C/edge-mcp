#!/usr/bin/env node
// Minimal MCP client driver for edge-mcp (Streamable HTTP, stateless mode).
// Usage: node mcp_call.mjs <toolName> [jsonArgs] [--shot <outPath>]
//
// Prints text content to stdout. Image content is written to <outPath>
// (default shot-<ts>.png) and the path is printed as "[image saved: ...]".

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeFile, readFile } from "node:fs/promises";

const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:7123/mcp";

function parseArgv(argv) {
  const out = { tool: null, jsonArgs: null, shotPath: null, argsFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--shot" && argv[i + 1]) {
      out.shotPath = argv[++i];
    } else if (a === "--args-file" && argv[i + 1]) {
      out.argsFile = argv[++i];
    } else if (out.tool === null) {
      out.tool = a;
    } else if (out.jsonArgs === null) {
      out.jsonArgs = a;
    }
  }
  return out;
}

const { tool, jsonArgs, shotPath, argsFile } = parseArgv(process.argv.slice(2));
if (!tool) {
  console.error("usage: node mcp_call.mjs <toolName> [jsonArgs|--args-file <path>] [--shot <path>]");
  process.exit(2);
}

let callArgs = {};
if (argsFile) {
  try {
    const raw = (await readFile(argsFile, "utf8")).replace(/^\uFEFF/, "").trim();
    callArgs = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Bad args file:", e.message);
    process.exit(2);
  }
} else if (jsonArgs) {
  try {
    callArgs = JSON.parse(jsonArgs);
  } catch (e) {
    console.error("Bad JSON args:", e.message);
    process.exit(2);
  }
}

const client = new Client({ name: "edge-mcp-driver", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

try {
  await client.connect(transport);
  const res = await client.callTool({ name: tool, arguments: callArgs });

  let wrote = false;
  for (const item of res.content || []) {
    if (item.type === "text") {
      process.stdout.write(item.text + "\n");
      wrote = true;
    } else if (item.type === "image") {
      const ext = (item.mimeType || "").includes("jpeg") ? "jpg" : "png";
      const outPath = shotPath || `shot-${Date.now()}.${ext}`;
      await writeFile(outPath, Buffer.from(item.data, "base64"));
      process.stdout.write(`[image saved: ${outPath}]\n`);
      wrote = true;
    }
  }
  if (!wrote) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  if (res.isError) process.exitCode = 1;
} catch (err) {
  console.error("MCP error:", err.message);
  process.exit(1);
} finally {
  try { await client.close(); } catch {}
  try { await transport.close(); } catch {}
}
