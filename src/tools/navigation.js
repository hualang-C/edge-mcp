// Navigation tools: navigate, go_back, go_forward, reload.
// All operate on the active tab.

import { z } from "zod";
import { getActivePage } from "../browser.js";
import { runTool } from "./run.js";

// waitUntil options understood by puppeteer's goto/reload.
const waitUntilSchema = z
  .enum(["load", "domcontentloaded", "networkidle0", "networkidle2"])
  .default("load")
  .describe(
    "When to consider navigation finished: load (default), domcontentloaded, networkidle0 (500ms no requests), networkidle2 (500ms with <=2 requests)"
  );

export const navigateTool = {
  name: "navigate",
  description: "Navigate the active Edge tab to a URL.",
  inputSchema: {
    url: z.string().url().describe("Absolute URL, e.g. https://example.com"),
    waitUntil: waitUntilSchema,
  },
  handler: async ({ url, waitUntil }) =>
    runTool(async () => {
      const page = await getActivePage();
      const resp = await page.goto(url, { waitUntil, timeout: 30000 });
      const status = resp ? resp.status() : "(no response)";
      return `Navigated to ${page.url()} (HTTP ${status})`;
    }),
};

export const goBackTool = {
  name: "go_back",
  description: "Go back one step in the active tab's history.",
  inputSchema: {},
  handler: async () =>
    runTool(async () => {
      const page = await getActivePage();
      const ok = await page.goBack({ waitUntil: "load", timeout: 30000 });
      return ok ? `Went back, now at ${page.url()}` : "Already at the earliest history entry";
    }),
};

export const goForwardTool = {
  name: "go_forward",
  description: "Go forward one step in the active tab's history.",
  inputSchema: {},
  handler: async () =>
    runTool(async () => {
      const page = await getActivePage();
      const ok = await page.goForward({ waitUntil: "load", timeout: 30000 });
      return ok ? `Went forward, now at ${page.url()}` : "Already at the latest history entry";
    }),
};

export const reloadTool = {
  name: "reload",
  description: "Reload the active tab.",
  inputSchema: {
    waitUntil: waitUntilSchema,
  },
  handler: async ({ waitUntil }) =>
    runTool(async () => {
      const page = await getActivePage();
      await page.reload({ waitUntil, timeout: 30000 });
      return `Reloaded, now at ${page.url()}`;
    }),
};

export const navigationTools = [navigateTool, goBackTool, goForwardTool, reloadTool];
