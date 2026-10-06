// Tab management tools: list_tabs, new_tab, switch_tab, close_tab.
// "switch_tab" brings a tab to the front (and returns its targetId so the
// caller can pass it to other tools via their optional targetId param).

import { z } from "zod";
import { getActivePage, getAllPages, getBrowser } from "../browser.js";
import { runTool } from "./run.js";

const targetIdSchema = z
  .string()
  .min(1)
  .describe("Tab targetId as returned by list_tabs");

export const listTabsTool = {
  name: "list_tabs",
  description: "List all open tabs in Edge with their targetId, URL, and title.",
  inputSchema: {},
  handler: async () =>
    runTool(async () => {
      const pages = await getAllPages();
      const tabs = pages.map((p) => {
        const t = p.target();
        return {
          targetId: t._targetId,
          url: p.url(),
          title: "(loading)",
          type: t.type(),
        };
      });
      // Titles require an async fetch; fill them in if reachable.
      for (const tab of tabs) {
        const page = pages.find((p) => p.target()._targetId === tab.targetId);
        if (page) {
          try {
            tab.title = await page.title();
          } catch {
            // leave "(loading)"
          }
        }
      }
      return { count: tabs.length, tabs };
    }),
};

export const newTabTool = {
  name: "new_tab",
  description: "Open a new tab in Edge and optionally navigate it to a URL. Returns the new tab's targetId.",
  inputSchema: {
    url: z
      .string()
      .url()
      .optional()
      .describe("URL to open. Omit for a blank tab (about:blank)."),
  },
  handler: async ({ url }) =>
    runTool(async () => {
      const b = await getBrowser();
      const page = await b.newPage();
      if (url) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
          // Don't fail the whole call if nav times out; the tab still exists.
        });
      }
      return { targetId: page.target()._targetId, url: page.url() };
    }),
};

export const switchTabTool = {
  name: "switch_tab",
  description:
    "Bring a tab to the front so it becomes the active tab. All navigation/interaction/read tools operate on the active tab, so call this first to target a specific tab.",
  inputSchema: {
    targetId: targetIdSchema,
  },
  handler: async ({ targetId }) =>
    runTool(async () => {
      const page = await getActivePage(targetId);
      await page.bringToFront();
      return { targetId, url: page.url() };
    }),
};

export const closeTabTool = {
  name: "close_tab",
  description:
    "Close a tab. If no targetId is given, closes the active tab. If the last tab is closed, Edge's behavior depends on the user-data-dir.",
  inputSchema: {
    targetId: targetIdSchema.optional().describe("Tab to close. Omit to close the active tab."),
  },
  handler: async ({ targetId }) =>
    runTool(async () => {
      const page = await getActivePage(targetId);
      const closedId = page.target()._targetId;
      await page.close();
      return { closed: closedId };
    }),
};

export const tabTools = [listTabsTool, newTabTool, switchTabTool, closeTabTool];
