import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sendEmail,
  watchCreatedEmail,
  ticketsAvailableEmail,
  bookingConfirmedEmail,
  paymentFailedEmail,
  money,
} from "./email.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const savedKey = process.env.RESEND_API_KEY;

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
});

describe("sendEmail", () => {
  it("posts to Resend with bearer auth and returns the message id", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const res = await sendEmail(
      { to: "a@b.com", subject: "hi", html: "<p>hi</p>" },
      async (url, init) => {
        seenUrl = String(url);
        seenAuth = String((init?.headers as Record<string, string>).Authorization ?? "");
        return jsonResponse({ id: "msg_123" });
      },
    );
    assert.equal(res.sent, true);
    assert.equal(res.id, "msg_123");
    assert.equal(seenUrl, "https://api.resend.com/emails");
    assert.equal(seenAuth, "Bearer re_test_key");
  });

  it("returns sent:false (never throws) when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    let called = false;
    const res = await sendEmail(
      { to: "a@b.com", subject: "hi", html: "<p>hi</p>" },
      async () => {
        called = true;
        return jsonResponse({});
      },
    );
    assert.equal(res.sent, false);
    assert.equal(called, false);
    assert.match(res.reason ?? "", /not configured/);
  });

  it("returns sent:false on Resend HTTP errors", async () => {
    const res = await sendEmail({ to: "a@b.com", subject: "hi", html: "<p>hi</p>" }, async () =>
      jsonResponse({ message: "bad" }, 401),
    );
    assert.equal(res.sent, false);
    assert.match(res.reason ?? "", /401/);
  });

  it("returns sent:false on network failure", async () => {
    const res = await sendEmail({ to: "a@b.com", subject: "hi", html: "<p>hi</p>" }, async () => {
      throw new Error("socket hang up");
    });
    assert.equal(res.sent, false);
    assert.match(res.reason ?? "", /socket hang up/);
  });
});

describe("templates", () => {
  it("watchCreatedEmail escapes HTML and includes spending summary", () => {
    const { subject, html } = watchCreatedEmail({
      movieTitle: "Dune <Part> 3",
      zip: "75078",
      ticketCount: 2,
      maxTicketPriceCents: 2000,
      maxTotalCents: 4000,
      autoBookEnabled: true,
      appUrl: "https://example.com",
    });
    assert.equal(subject, "Your watch for Dune <Part> 3 is live");
    assert.ok(!html.includes("Dune <Part> 3"), "raw HTML must be escaped");
    assert.ok(html.includes("Dune &lt;Part&gt; 3"));
    assert.ok(html.includes("$40.00"));
    assert.ok(html.includes("#0a0a0b"), "dark theme background present");
  });

  it("ticketsAvailableEmail includes theater, showtime and CTA", () => {
    const { subject, html } = ticketsAvailableEmail({
      movieTitle: "Dune 3",
      theaterName: "Cinemark Frisco",
      showtime: "Fri, Dec 18 · 7:30 PM",
      pricePerTicketCents: 1850,
      ticketCount: 2,
      bookingUrl: "https://tickets.example.com/x",
    });
    assert.equal(subject, "Tickets found for Dune 3!");
    assert.ok(html.includes("Cinemark Frisco"));
    assert.ok(html.includes("Book now"));
    assert.ok(html.includes("https://tickets.example.com/x"));
  });

  it("bookingConfirmedEmail shows charge and last4", () => {
    const { html } = bookingConfirmedEmail({
      movieTitle: "Dune 3",
      theaterName: "AMC Stonebriar",
      showtime: "Sat 8:00 PM",
      ticketCount: 2,
      totalChargedCents: 3700,
      last4: "4242",
      appUrl: "https://example.com",
    });
    assert.ok(html.includes("$37.00"));
    assert.ok(html.includes("4242"));
  });

  it("paymentFailedEmail explains the failure", () => {
    const { subject, html } = paymentFailedEmail({
      movieTitle: "Dune 3",
      amountCents: 4000,
      reason: "Your card was declined.",
      appUrl: "https://example.com",
    });
    assert.match(subject, /payment failed/);
    assert.ok(html.includes("Your card was declined."));
  });

  it("money formats cents", () => {
    assert.equal(money(2000), "$20.00");
    assert.equal(money(5), "$0.05");
  });
});
