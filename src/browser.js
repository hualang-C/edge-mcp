// Edge browser connection manager (singleton).
//
// Connects to an Edge instance that the user has already launched with
// --remote-debugging-port=9222 (override with EDGE_CDP_PORT). The connection
// is lazy: nothing happens until the first tool call, so the MCP server can
// start even when Edge is not running and report a friendly error instead of
// crashing.

import puppeteer from "puppeteer-core";

// The port Edge exposes CDP on. Override via EDGE_CDP_PORT.
const CDP_PORT = Number(process.env.EDGE_CDP_PORT) || 9222;
const CDP_HTTP = `http://127.0.0.1:${CDP_PORT}`;

// Singleton state. `browser` is the puppeteer Browser handle; `pages` caches
// the page list so getActivePage() can pick the most recently used one.
let browser = null;
let connecting = null; // in-flight connect promise, dedupes concurrent calls

/**
 * Fetch the browser-level WebSocket debugger URL from /json/version.
 * This is the endpoint puppeteer's connect() needs (not a per-tab URL).
 */
async function fetchBrowserWSEndpoint() {
  // Use global fetch (Node >= 18).
  const res = await fetch(`${CDP_HTTP}/json/version`);
  if (!res.ok) {
    throw new Error(`Edge /json/version returned HTTP ${res.status}`);
  }
  const data = await res.json();
  const wsUrl = data.webSocketDebuggerUrl;
  if (!wsUrl) {
    throw new Error("Edge /json/version did not contain webSocketDebuggerUrl");
  }
  return wsUrl;
}

/**
 * Connect to the running Edge instance (idempotent, concurrency-safe).
 * Returns the puppeteer Browser handle. If already connected and the
 * connection is alive, returns the cached handle without re-connecting.
 *
 * Throws a friendly error if Edge is not reachable, with instructions on
 * how to launch it.
 */
export async function getBrowser() {
  // Fast path: reuse a live connection.
  if (browser) {
    try {
      // Cheap liveness probe; throws if the browser has gone away.
      if (browser.connected) return browser;
    } catch {
      // fall through to reconnect
    }
    // Connection is dead — drop it and reconnect.
    browser = null;
  }

  // Dedupe concurrent connect attempts (e.g. parallel tool calls).
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const wsUrl = await fetchBrowserWSEndpoint();
      const b = await puppeteer.connect({
        browserWSEndpoint: wsUrl,
        // Keep Edge's own viewport rather than forcing 800x600.
        defaultViewport: null,
      });
      browser = b;
      // If Edge closes underneath us, clear the handle so the next call
      // reconnects instead of reusing a dead handle.
      b.on("disconnected", () => {
        browser = null;
      });
      return b;
    } catch (err) {
      // Surface a clear, actionable message for the most common failure.
      // A failed fetch raises `TypeError: fetch failed` with no `code` of
      // its own — the real code (ECONNREFUSED, …) sits on err.cause — so
      // check both spots.
      const code = err?.cause?.code ?? err?.code;
      const unreachable =
        code === "ECONNREFUSED" || err?.message?.startsWith("fetch failed");
      const cause = unreachable
        ? `Could not reach Edge at ${CDP_HTTP}. Is Edge running with --remote-debugging-port=${CDP_PORT}?`
        : `Failed to connect to Edge: ${err.message}`;
      const help =
        `Launch Edge with:\n` +
        `  msedge.exe --remote-debugging-port=${CDP_PORT} --user-data-dir="<empty-dir>" --remote-allow-origins=*`;
      const e = new Error(`${cause}\n${help}`);
      e.cause = err;
      throw e;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * List pages defensively.
 *
 * `browser.pages()` reads puppeteer's cached target list, which can go stale
 * for a long-lived connection: observed in practice when another CDP client
 * closed and recreated tabs behind our back — the cache reported zero tabs
 * while Edge actually had a page open, so every tool failed with
 * "Edge has no open tabs".
 *
 * If the cache looks empty, drop the connection and reconnect once: a fresh
 * connection rebuilds the target list from the browser. Cheap, and it turns a
 * permanently-blind server into a self-healing one.
 */
async function listPagesResilient() {
  const b = await getBrowser();
  const pages = await b.pages();
  if (pages.length) return pages;

  await disconnect();
  const fresh = await getBrowser();
  return fresh.pages();
}

/**
 * Return the "active" page — the page the user most likely cares about.
 * Heuristic: among non-blank, non-internal pages, pick the last one in the
 * browser's list. Edge keeps pages ordered by recency, so the tail is the
 * most recently focused tab.
 *
 * If `targetId` is supplied, return that specific page instead.
 */
export async function getActivePage(targetId) {
  const pages = await listPagesResilient();

  if (targetId) {
    const page = pages.find((p) => p.target()._targetId === targetId);
    if (!page) {
      throw new Error(
        `No tab with targetId "${targetId}". Call list_tabs to see available tabs.`
      );
    }
    return page;
  }

  // Filter out internal pages when possible: Edge's own pages are edge://
  // (newtab, settings, …); chrome:// covers scheme redirects and devtools://
  // the inspector.
  const usable = pages.filter((p) => {
    const url = p.url();
    return (
      url &&
      !url.startsWith("edge://") &&
      !url.startsWith("chrome://") &&
      !url.startsWith("devtools://")
    );
  });

  // Fall back to the raw list if everything is internal.
  const pool = usable.length ? usable : pages;
  if (!pool.length) {
    throw new Error("Edge has no open tabs. Use new_tab to create one.");
  }
  return pool[pool.length - 1];
}

/**
 * Return all pages, for list_tabs.
 */
export async function getAllPages() {
  return listPagesResilient();
}

/**
 * Return the underlying browser for tab-creation / closing.
 */
export { getBrowser as getBrowserHandle };

/**
 * Disconnect from Edge. Does NOT close the browser (Edge keeps running).
 * Safe to call multiple times.
 */
export async function disconnect() {
  if (browser) {
    try {
      browser.disconnect();
    } catch {
      // ignore — best effort cleanup
    }
    browser = null;
  }
}
