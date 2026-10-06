#!/usr/bin/env node
// Read a specific tab's title/url/text and bring it to front.
import { getActivePage, disconnect } from "./src/browser.js";
const tid = process.argv[2];
const page = await getActivePage(tid);
await page.bringToFront();
const out = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  text: (document.body.innerText || "").slice(0, 1500),
}));
console.log(JSON.stringify(out, null, 2));
await disconnect();
