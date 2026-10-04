/**
 * Playwright-based browser tools for the MovieWatch deep agent.
 *
 * Two read-only tools:
 *  - browse_theater_site — load a theater website page and extract
 *    showtime/pricing text for a movie.
 *  - check_availability — deeper read of a specific showtime page for seat
 *    availability signals.
 *
 * SAFETY RULES (enforced in code):
 *  - READ-ONLY: no form fills, no clicks on buy/checkout buttons, no logins.
 *    Purchasing happens ONLY through the Stripe-gated purchase_tickets tool.
 *  - Domain allowlist: only theater/ticketing domains may be loaded.
 *  - Bot protection: if a CAPTCHA, login wall, "access denied", or bot-
 *    challenge page is detected, the tool returns "BLOCKED: <reason>" and
 *    stops — it never attempts to bypass.
 *  - Rate limit: max 1 page per 5 seconds per domain.
 *  - Realistic desktop Chrome user agent.
 *
 * Playwright is an OPTIONAL runtime dependency: it is loaded lazily via
 * createRequire so the API process (which never uses these tools) doesn't
 * need it. Deploy must run `playwright install chromium` (see Dockerfile).
 */
import { createRequire } from "node:module";
import { tool } from "langchain";
import { z } from "zod";
import { writeAudit } from "../lib/audit.js";
import type { PrismaClient } from "@moviewatch/database";

/* ------------------------------------------------------------------ */
/* Minimal structural Playwright types (no @types/playwright needed).  */
/* ------------------------------------------------------------------ */

export interface BrowserPageLike {
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  title(): Promise<string>;
  content(): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserContextLike {
  newPage(): Promise<BrowserPageLike>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(opts?: { userAgent?: string }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export type BrowserLauncher = () => Promise<BrowserLike>;

export interface BrowserToolDeps {
  db: PrismaClient;
  /** Injectable browser launcher (tests). Defaults to lazy Playwright. */
  launchBrowser?: BrowserLauncher;
  /** Extra allowed hostnames beyond the built-in theater allowlist. */
  allowedHosts?: string[];
  /** Injectable clock/sleep (tests). */
  now?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Safety: domain allowlist + bot-protection detection.                */
/* ------------------------------------------------------------------ */

/** Known US theater-chain / ticketing domains. */
const THEATER_DOMAIN_ALLOWLIST = new Set([
  "cinemark.com",
  "www.cinemark.com",
  "amctheatres.com",
  "www.amctheatres.com",
  "fandango.com",
  "www.fandango.com",
  "tickets.fandango.com",
  "atomtickets.com",
  "www.atomtickets.com",
  "regmovies.com",
  "www.regmovies.com",
  "marcustheatres.com",
  "www.marcustheatres.com",
  "harkinstheatres.com",
  "www.harkinstheatres.com",
  "brawleytheatres.com",
  "cineplex.com",
  "www.cineplex.com",
  "landmarktheatres.com",
  "www.landmarktheatres.com",
  "cmxcinemas.com",
  "www.cmxcinemas.com",
  "studio-movie-grill.com",
  "www.studio-movie-grill.com",
  "flixbrewhouse.com",
  "www.flixbrewhouse.com",
  "alamo-drafthouse.com",
  "www.alamo-drafthouse.com",
  "santikos.com",
  "www.santikos.com",
]);

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PAGE_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MS = 5_000;
const MAX_TEXT_CHARS = 4_000;

/** Per-domain last-visit timestamps (module-level: shared across tool calls). */
const lastVisitByHost = new Map<string, number>();

/** For tests: reset the rate-limit tracker. */
export function resetBrowserRateLimits(): void {
  lastVisitByHost.clear();
}

const BOT_SIGNALS = [
  /captcha/i,
  /are you a robot/i,
  /verify you are (a )?human/i,
  /access denied/i,
  /request blocked/i,
  /just a moment/i, // Cloudflare challenge
  /cloudflare/i,
  /datadome/i,
  /perimeterx/i,
  /press (&|and) hold/i, // human-verification widgets
  /sign in to continue/i,
  /log in to continue/i,
];

export function detectBotProtection(args: {
  title: string;
  html: string;
  statusOk: boolean;
}): string | null {
  const haystack = `${args.title}\n${args.html.slice(0, 20_000)}`;
  for (const re of BOT_SIGNALS) {
    if (re.test(haystack)) return `bot-protection signal matched: ${re.source}`;
  }
  if (!args.statusOk) return "page did not load successfully (non-OK navigation)";
  return null;
}

function hostAllowed(url: string, extraHosts: string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (THEATER_DOMAIN_ALLOWLIST.has(host)) return true;
  return extraHosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
}

async function defaultLaunchBrowser(): Promise<BrowserLike> {
  let chromium: { launch(opts?: { headless?: boolean }): Promise<BrowserLike> };
  try {
    // Lazy optional dependency — the API process never loads Playwright.
    const require = createRequire(import.meta.url);
    ({ chromium } = require("playwright") as {
      chromium: { launch(opts?: { headless?: boolean }): Promise<BrowserLike> };
    });
  } catch {
    throw new Error(
      "browser automation unavailable: the 'playwright' package is not installed on this machine",
    );
  }
  return chromium.launch({ headless: true });
}

async function enforceRateLimit(host: string, now: () => number, sleepMs: (ms: number) => Promise<void>): Promise<void> {
  const last = lastVisitByHost.get(host) ?? 0;
  const elapsed = now() - last;
  if (elapsed < RATE_LIMIT_MS) {
    await sleepMs(RATE_LIMIT_MS - elapsed);
  }
  lastVisitByHost.set(host, now());
}

/** Strip tags/scripts/styles → collapsed plain text. */
export function htmlToText(html: string, maxChars = MAX_TEXT_CHARS): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/** Pull out lines mentioning showtimes, prices, or availability. */
export function extractShowtimeSignals(text: string, movieTitle?: string): string[] {
  const signals: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/(?<=[.!?])\s+|\n/).map((l) => l.trim()).filter(Boolean);
  const timeRe = /\b\d{1,2}:\d{2}\s?(am|pm)\b/i;
  const priceRe = /\$\s?\d+(\.\d{2})?/;
  const availRe = /sold out|available|only \d+ (left|seats?)|select seats|get tickets|buy tickets/i;
  const movieKeyword = (movieTitle ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  for (const line of lines) {
    if (line.length > 220) continue;
    // Time/price/availability lines are inherently relevant on theater
    // showtime pages; the movie keyword is a ranking bonus, not a gate.
    if (timeRe.test(line) || priceRe.test(line) || availRe.test(line)) {
      const key = line.slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        signals.push(line.slice(0, 200));
      }
    }
    if (signals.length >= 25) break;
  }
  // Movie-title lines first (highest relevance).
  signals.sort((a, b) => {
    const ai = movieKeyword ? a.toLowerCase().includes(movieKeyword) : false;
    const bi = movieKeyword ? b.toLowerCase().includes(movieKeyword) : false;
    return Number(bi) - Number(ai);
  });
  return signals;
}

async function loadPage(
  deps: BrowserToolDeps,
  url: string,
): Promise<{ title: string; text: string } | { blocked: string }> {
  const now = deps.now ?? Date.now;
  const sleepMs = deps.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const extraHosts = deps.allowedHosts ?? [];

  if (!hostAllowed(url, extraHosts)) {
    let host = "(invalid url)";
    try {
      host = new URL(url).hostname;
    } catch { /* keep placeholder */ }
    return { blocked: `domain not allowed: ${host}. Only theater/ticketing sites may be browsed.` };
  }
  const host = new URL(url).hostname.toLowerCase();
  await enforceRateLimit(host, now, sleepMs);

  const launch = deps.launchBrowser ?? defaultLaunchBrowser;
  let browser: BrowserLike | null = null;
  let context: BrowserContextLike | null = null;
  let page: BrowserPageLike | null = null;
  try {
    browser = await launch();
    context = await browser.newContext({ userAgent: DESKTOP_UA });
    page = await context.newPage();
    let navOk = true;
    try {
      await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
    } catch {
      navOk = false;
    }
    const title = await page.title().catch(() => "");
    const html = await page.content().catch(() => "");
    const botReason = detectBotProtection({ title, html, statusOk: navOk });
    if (botReason) {
      await writeAudit(deps.db, {
        actorType: "agent",
        actorId: "browser-tools",
        action: "browser.blocked_bot_protection",
        resourceType: "Url",
        resourceId: host,
      }).catch(() => {});
      return { blocked: `BLOCKED: ${botReason} — will not attempt to bypass.` };
    }
    return { title, text: htmlToText(html) };
  } catch (err) {
    return { blocked: `BLOCKED: navigation failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)}` };
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

const browseTheaterSiteSchema = z.object({
  url: z.string().url().describe("HTTPS URL of a theater website page to read."),
  movieTitle: z.string().describe("Movie title to look for on the page."),
});

const checkAvailabilitySchema = z.object({
  url: z.string().url().describe("HTTPS URL of a specific showtime/tickets page to read."),
});

/**
 * Read a theater website page and extract showtime/pricing info for a movie.
 * READ-ONLY: never fills forms, never clicks buy buttons, never logs in.
 */
export function browseTheaterSite(deps: BrowserToolDeps) {
  return tool(
    async ({ url, movieTitle }: z.infer<typeof browseTheaterSiteSchema>): Promise<string> => {
      const result = await loadPage(deps, url);
      if ("blocked" in result) return result.blocked;
      const signals = extractShowtimeSignals(result.text, movieTitle);
      await writeAudit(deps.db, {
        actorType: "agent",
        actorId: "browser-tools",
        action: "browser.page_read",
        resourceType: "Url",
        resourceId: url.slice(0, 200),
      }).catch(() => {});
      const header = `Page: ${result.title || url}\nMovie: ${movieTitle}\n`;
      if (signals.length === 0) {
        return (
          header +
          "No showtime/pricing signals found for this movie on the page. " +
          `Page excerpt: ${result.text.slice(0, 500)}`
        );
      }
      return header + "Showtime signals:\n- " + signals.join("\n- ");
    },
    {
      name: "browse_theater_site",
      description:
        "READ-ONLY: load a theater website page and extract showtime/pricing text " +
        "for a movie. Only theater/ticketing domains are allowed; CAPTCHA/login " +
        "walls return BLOCKED. Never purchases anything.",
      schema: browseTheaterSiteSchema,
    },
  );
}

/**
 * Read a specific showtime page and summarize seat availability signals.
 * READ-ONLY: never selects seats or proceeds to checkout.
 */
export function checkAvailability(deps: BrowserToolDeps) {
  return tool(
    async ({ url }: z.infer<typeof checkAvailabilitySchema>): Promise<string> => {
      const result = await loadPage(deps, url);
      if ("blocked" in result) return result.blocked;
      const text = result.text.toLowerCase();
      const verdict = /sold out|no longer available|unavailable/.test(text)
        ? "APPEARS SOLD OUT"
        : /select (your )?seats|choose seats|available|get tickets|buy tickets/.test(text)
          ? "APPEARS AVAILABLE"
          : "UNCLEAR — no clear availability signal";
      const signals = extractShowtimeSignals(result.text);
      await writeAudit(deps.db, {
        actorType: "agent",
        actorId: "browser-tools",
        action: "browser.availability_checked",
        resourceType: "Url",
        resourceId: url.slice(0, 200),
      }).catch(() => {});
      return (
        `Page: ${result.title || url}\nAvailability: ${verdict}\n` +
        (signals.length ? "Signals:\n- " + signals.join("\n- ") : "No detailed signals extracted.")
      );
    },
    {
      name: "check_availability",
      description:
        "READ-ONLY: read a showtime/tickets page and report seat availability " +
        "(sold out vs available). Never selects seats or checks out.",
      schema: checkAvailabilitySchema,
    },
  );
}
