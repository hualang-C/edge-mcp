// Interaction tools: click, type, fill, press.
// All operate on the active tab. Selectors are CSS.

import { z } from "zod";
import { getActivePage } from "../browser.js";
import { runTool } from "./run.js";

const selectorSchema = z
  .string()
  .min(1)
  .describe("CSS selector of the element, e.g. #search-button, input[name=q]");

export const clickTool = {
  name: "click",
  description: "Click an element matching the CSS selector on the active tab.",
  inputSchema: {
    selector: selectorSchema,
    button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button"),
    clickCount: z.number().int().min(1).max(3).default(1).describe("Number of clicks (1-3)"),
    delay: z.number().int().min(0).max(5000).default(0).describe("Delay between mousedown and mouseup in ms"),
  },
  handler: async ({ selector, button, clickCount, delay }) =>
    runTool(async () => {
      const page = await getActivePage();
      await page.click(selector, { button, clickCount, delay });
      return `Clicked "${selector}"`;
    }),
};

export const typeTool = {
  name: "type",
  description:
    "Type text into a focusable element matching the CSS selector, simulating keystrokes (fires key events). Use for typing into inputs or contenteditable regions. For filling a form field in one shot, prefer fill.",
  inputSchema: {
    selector: selectorSchema,
    text: z.string().describe("Text to type"),
    delay: z.number().int().min(0).max(500).default(0).describe("Delay between keystrokes in ms (0 = instant)"),
  },
  handler: async ({ selector, text, delay }) =>
    runTool(async () => {
      const page = await getActivePage();
      await page.type(selector, text, { delay });
      return `Typed ${text.length} char(s) into "${selector}"`;
    }),
};

export const fillTool = {
  name: "fill",
  description:
    "Set the value of an input/textarea/select matching the CSS selector in one shot (no key events). Clears the field first. Faster than type for setting a known value. Sets the value via the DOM and dispatches an input event so frameworks (React, Vue, etc.) pick up the change.",
  inputSchema: {
    selector: selectorSchema,
    text: z.string().describe("Value to set"),
  },
  handler: async ({ selector, text }) =>
    runTool(async () => {
      const page = await getActivePage();
      // page.fill was removed in puppeteer-core v23 and the Locator API in
      // this build is minimal, so set the value directly via the DOM.
      // Dispatching 'input' (and 'change') makes most frameworks notice.
      const ok = await page.evaluate(
        (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        selector,
        text
      );
      if (!ok) return `No element matches "${selector}"`;
      return `Filled "${selector}" with ${text.length} char(s)`;
    }),
};

export const pressTool = {
  name: "press",
  description:
    "Press a key on the active tab (sent to the currently focused element). Accepts KeyDescriptor names like Enter, Tab, Escape, ArrowDown, or single characters like 'a'.",
  inputSchema: {
    key: z
      .string()
      .min(1)
      .describe("Key name, e.g. Enter, Tab, Escape, ArrowDown, Backspace, or a single character like 'a'"),
    hold: z.number().int().min(0).max(5000).default(0).describe("Hold duration in ms (0 = tap)"),
  },
  handler: async ({ key, hold }) =>
    runTool(async () => {
      const page = await getActivePage();
      if (hold > 0) {
        await page.keyboard.down(key);
        await new Promise((r) => setTimeout(r, hold));
        await page.keyboard.up(key);
      } else {
        await page.keyboard.press(key);
      }
      return `Pressed ${key}`;
    }),
};

export const interactionTools = [clickTool, typeTool, fillTool, pressTool];
