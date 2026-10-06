// Read tools: screenshot, get_text, get_html, evaluate.
// All operate on the active tab unless a selector scopes them.

import { z } from "zod";
import { getActivePage } from "../browser.js";
import { runTool } from "./run.js";

const selectorSchema = z
  .string()
  .min(1)
  .describe("CSS selector. Omit to read the whole page.");

export const screenshotTool = {
  name: "screenshot",
  description:
    "Capture a screenshot of the active tab (full page or viewport) and return it as an image. The image is returned inline so the model can see it.",
  inputSchema: {
    format: z.enum(["png", "jpeg"]).default("png").describe("Image format"),
    fullPage: z.boolean().default(true).describe("Capture the entire scrollable page (true) or just the viewport (false)"),
    quality: z.number().int().min(1).max(100).default(80).describe("JPEG quality 1-100 (ignored for PNG)"),
  },
  handler: async ({ format, fullPage, quality }) => {
    try {
      const page = await getActivePage();
      const shot = await page.screenshot({
        type: format,
        fullPage,
        quality: format === "jpeg" ? quality : undefined,
      });
      // puppeteer-core v23 returns a Uint8Array here, and Uint8Array#toString()
      // ignores the "base64" argument (it yields "137,80,78,71,..."), which the
      // MCP SDK rejects as "Invalid Base64 string". Wrap it in a Buffer first.
      const buf = Buffer.from(shot);
      return {
        content: [
          {
            type: "image",
            data: buf.toString("base64"),
            mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
};

export const getTextTool = {
  name: "get_text",
  description:
    "Return the visible text content of an element (or the whole page if no selector). Whitespace is collapsed; hidden text is excluded.",
  inputSchema: {
    selector: selectorSchema.optional().describe("CSS selector. Omit to read the whole page."),
  },
  handler: async ({ selector }) =>
    runTool(async () => {
      const page = await getActivePage();
      if (selector) {
        const el = await page.$(selector);
        if (!el) return `No element matches "${selector}"`;
        // page.evaluate returns the innerText (visible text) of the element.
        return await page.evaluate((node) => node.innerText, el);
      }
      return await page.evaluate(() => document.body.innerText);
    }),
};

export const getHtmlTool = {
  name: "get_html",
  description:
    "Return the HTML of an element (outerHTML) or the whole document. Useful for inspecting structure; for visible text use get_text.",
  inputSchema: {
    selector: selectorSchema.optional().describe("CSS selector. Omit to read the whole document."),
  },
  handler: async ({ selector }) =>
    runTool(async () => {
      const page = await getActivePage();
      if (selector) {
        const el = await page.$(selector);
        if (!el) return `No element matches "${selector}"`;
        return await page.evaluate((node) => node.outerHTML, el);
      }
      return await page.content();
    }),
};

export const evaluateTool = {
  name: "evaluate",
  description:
    "Run a JavaScript expression in the active tab's page context and return the result as JSON. The expression is evaluated as the body of an async function, so you can use await. DOM globals (document, window) are available. Results must be JSON-serializable.",
  inputSchema: {
    expression: z
      .string()
      .min(1)
      .describe(
        "JavaScript to evaluate, e.g. document.title or (() => document.querySelectorAll('a').length)()"
      ),
  },
  handler: async ({ expression }) =>
    runTool(async () => {
      const page = await getActivePage();
      // Wrap so both plain expressions and arrow fns work.
      const result = await page.evaluate(`(async () => (${expression}))()`);
      return result;
    }),
};

export const readTools = [screenshotTool, getTextTool, getHtmlTool, evaluateTool];
