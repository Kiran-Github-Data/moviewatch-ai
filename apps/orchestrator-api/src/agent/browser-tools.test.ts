import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  browseTheaterSite,
  checkAvailability,
  detectBotProtection,
  extractShowtimeSignals,
  htmlToText,
  resetBrowserRateLimits,
  type BrowserLauncher,
  type BrowserToolDeps,
  type BrowserPageLike,
} from "./browser-tools.js";

const fakeDb = {
  auditLog: { create: async () => ({}) },
} as never;

function fakePage(html: string, title = "Cinemark Showtimes"): BrowserPageLike {
  return {
    goto: async () => {},
    title: async () => title,
    content: async () => html,
    close: async () => {},
  };
}

function launcherFor(html: string, title?: string): BrowserLauncher {
  return async () => ({
    newContext: async () => ({
      newPage: async () => fakePage(html, title),
      close: async () => {},
    }),
    close: async () => {},
  });
}

function deps(overrides: Partial<BrowserToolDeps> = {}): BrowserToolDeps {
  return {
    db: fakeDb,
    now: () => 1_000_000,
    sleepMs: async () => {},
    ...overrides,
  };
}

const THEATER_HTML = `
<html><head><title>Cinemark Frisco Square Showtimes</title></head><body>
<h1>Dune: Part Two</h1>
<p>Showtimes for Friday: 7:30pm Standard, 10:15pm IMAX.</p>
<p>Tickets from $12.50. Select seats to continue.</p>
</body></html>`;

describe("detectBotProtection", () => {
  it("flags CAPTCHA pages", () => {
    assert.ok(detectBotProtection({ title: "Verify", html: "please complete the captcha", statusOk: true }));
  });
  it("flags access-denied pages", () => {
    assert.ok(detectBotProtection({ title: "Access Denied", html: "request blocked", statusOk: true }));
  });
  it("passes clean pages", () => {
    assert.equal(detectBotProtection({ title: "Showtimes", html: "<p>7:30pm</p>", statusOk: true }), null);
  });
  it("flags failed navigation", () => {
    assert.ok(detectBotProtection({ title: "", html: "", statusOk: false }));
  });
});

describe("htmlToText / extractShowtimeSignals", () => {
  it("strips tags and scripts", () => {
    const t = htmlToText("<html><script>var x=1</script><body><p>Hello <b>World</b></p></body></html>");
    assert.equal(t, "Hello World");
  });
  it("extracts time/price/availability lines", () => {
    const signals = extractShowtimeSignals(
      "Dune showtimes: 7:30pm Standard. Tickets from $12.50. Select seats now. Weather is nice today.",
      "Dune",
    );
    assert.ok(signals.length >= 2);
    assert.ok(signals.some((s) => s.includes("7:30pm")));
  });
});

describe("browse_theater_site", () => {
  beforeEach(() => resetBrowserRateLimits());

  it("extracts showtime signals from an allowed theater domain", async () => {
    const t = browseTheaterSite(deps({ launchBrowser: launcherFor(THEATER_HTML) }));
    const out = await t.invoke({ url: "https://www.cinemark.com/theatres/frisco", movieTitle: "Dune: Part Two" });
    assert.ok(out.includes("7:30pm"), out.slice(0, 300));
    assert.ok(out.includes("$12.50"));
  });

  it("rejects non-theater domains", async () => {
    let launched = false;
    const t = browseTheaterSite(
      deps({ launchBrowser: async () => { launched = true; throw new Error("should not launch"); } }),
    );
    const out = await t.invoke({ url: "https://evil-phishing.example.com/tickets", movieTitle: "Dune" });
    assert.ok(out.includes("not allowed"));
    assert.equal(launched, false);
  });

  it("rejects non-https URLs", async () => {
    const t = browseTheaterSite(deps({ launchBrowser: launcherFor(THEATER_HTML) }));
    const out = await t.invoke({ url: "http://www.cinemark.com/x", movieTitle: "Dune" });
    assert.ok(out.includes("not allowed"));
  });

  it("returns BLOCKED on CAPTCHA pages without bypassing", async () => {
    const t = browseTheaterSite(
      deps({ launchBrowser: launcherFor("<html><body>Please complete the captcha</body></html>", "Security Check") }),
    );
    const out = await t.invoke({ url: "https://www.amctheatres.com/movies", movieTitle: "Dune" });
    assert.ok(out.startsWith("BLOCKED"), out.slice(0, 120));
  });

  it("reports a clean error when playwright is missing", async () => {
    const t = browseTheaterSite(deps({})); // no launchBrowser → tries real playwright
    const out = await t.invoke({ url: "https://www.cinemark.com/x", movieTitle: "Dune" });
    assert.ok(out.includes("BLOCKED"), out.slice(0, 200));
  });
});

describe("check_availability", () => {
  beforeEach(() => resetBrowserRateLimits());

  it("detects sold-out pages", async () => {
    const t = checkAvailability(
      deps({ launchBrowser: launcherFor("<html><body><h1>Sold out</h1><p>This showing is sold out.</p></body></html>") }),
    );
    const out = await t.invoke({ url: "https://www.cinemark.com/showtime/123" });
    assert.ok(out.includes("SOLD OUT"));
  });

  it("detects available pages", async () => {
    const t = checkAvailability(deps({ launchBrowser: launcherFor(THEATER_HTML) }));
    const out = await t.invoke({ url: "https://www.fandango.com/showtime/123" });
    assert.ok(out.includes("AVAILABLE"));
  });

  it("enforces the 5s per-domain rate limit", async () => {
    let now = 1_000_000;
    const sleeps: number[] = [];
    const d = deps({
      launchBrowser: launcherFor(THEATER_HTML),
      now: () => now,
      sleepMs: async (ms) => { sleeps.push(ms); now += ms; },
    });
    const t = browseTheaterSite(d);
    await t.invoke({ url: "https://www.cinemark.com/a", movieTitle: "Dune" });
    await t.invoke({ url: "https://www.cinemark.com/b", movieTitle: "Dune" });
    assert.equal(sleeps.length, 1);
    const waited = sleeps[0] ?? 0;
    assert.ok(waited > 4000 && waited <= 5000);
  });
});
