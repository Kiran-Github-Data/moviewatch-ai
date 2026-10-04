/**
 * Email notifications via Resend (https://resend.com).
 *
 * `RESEND_API_KEY` and `EMAIL_FROM` are read from the environment at call
 * time (not import time) so tests can stub them. HTTP is injectable so unit
 * tests never hit the real API.
 *
 * All sends are best-effort: callers should catch failures and continue —
 * a failed email must never break a watch create/arm/booking.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export interface EmailResult {
  sent: boolean;
  /** Resend message id when sent. */
  id?: string;
  /** Human-readable reason when skipped/failed. */
  reason?: string;
}

type FetchFn = typeof fetch;

const RESEND_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 10_000;

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM ?? "MovieWatch AI <onboarding@resend.dev>";
}

/** Low-level send. Returns { sent: false } (never throws) when unconfigured. */
export async function sendEmail(
  input: SendEmailInput,
  fetchFn: FetchFn = fetch,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }
  let res: Response;
  try {
    res = await fetchFn(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "").then((t) => t.slice(0, 200));
    return { sent: false, reason: `Resend HTTP ${res.status}: ${detail}` };
  }
  let id: string | undefined;
  try {
    const body = (await res.json()) as { id?: string };
    id = typeof body.id === "string" ? body.id : undefined;
  } catch {
    /* id stays undefined */
  }
  return { sent: true, id };
}

/* ------------------------------------------------------------------ */
/* Templates — dark cinematic theme matching the app.                  */
/* ------------------------------------------------------------------ */

function shell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#f4f1ea;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="display:inline-block;background:rgba(232,179,75,0.12);border:1px solid rgba(232,179,75,0.35);color:#e8b34b;font-size:11px;font-weight:700;letter-spacing:2px;padding:6px 14px;border-radius:999px;">MOVIEWATCH&nbsp;AI</div>
  </div>
  ${bodyHtml}
  <div style="margin-top:40px;padding-top:24px;border-top:1px solid #27272a;text-align:center;">
    <p style="font-size:12px;color:#71717a;margin:0;">MovieWatch AI — never miss a premiere again.</p>
    <p style="font-size:12px;color:#71717a;margin:8px 0 0;">You're receiving this because you created a ticket watch.</p>
  </div>
</div>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<div style="text-align:center;margin:28px 0;">
  <a href="${escapeAttr(href)}" style="display:inline-block;background:#e8b34b;color:#0a0a0b;font-weight:700;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">${escapeHtml(label)}</a>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface WatchCreatedTemplate {
  movieTitle: string;
  zip: string;
  ticketCount: number;
  maxTicketPriceCents: number;
  maxTotalCents: number;
  autoBookEnabled: boolean;
  appUrl: string;
}

export function watchCreatedEmail(t: WatchCreatedTemplate): { subject: string; html: string } {
  const subject = `Your watch for ${t.movieTitle} is live`;
  const html = shell(
    subject,
    `<h1 style="font-size:26px;margin:0 0 8px;color:#f4f1ea;">Your watch is live 🎬</h1>
<p style="font-size:15px;color:#a1a1aa;line-height:1.6;">We're now watching for <strong style="color:#f4f1ea;">${escapeHtml(t.movieTitle)}</strong> near <strong style="color:#f4f1ea;">${escapeHtml(t.zip)}</strong>.</p>
<div style="background:#141416;border:1px solid #27272a;border-radius:16px;padding:20px 24px;margin:24px 0;">
  <p style="margin:0 0 6px;font-size:14px;color:#a1a1aa;">${t.ticketCount} ticket${t.ticketCount === 1 ? "" : "s"} · up to <strong style="color:#e8b34b;">${money(t.maxTicketPriceCents)}</strong> each</p>
  <p style="margin:0 0 6px;font-size:14px;color:#a1a1aa;">Spending cap: <strong style="color:#e8b34b;">${money(t.maxTotalCents)}</strong> total</p>
  <p style="margin:0;font-size:14px;color:#a1a1aa;">Auto-booking: <strong style="color:${t.autoBookEnabled ? "#4ade80" : "#a1a1aa"};">${t.autoBookEnabled ? "ON — we'll buy the moment tickets drop" : "OFF — we'll email you first"}</strong></p>
</div>
<p style="font-size:14px;color:#a1a1aa;line-height:1.6;">What happens next: our agent checks for ticket releases around the clock. The instant seats matching your preferences appear${t.autoBookEnabled ? " and your card is charged within your cap" : ""}, you'll know.</p>
${ctaButton(t.appUrl, "View my watch")}`,
  );
  return { subject, html };
}

export interface WatchArmedTemplate {
  movieTitle: string;
  appUrl: string;
}

export function watchArmedEmail(t: WatchArmedTemplate): { subject: string; html: string } {
  const subject = `${t.movieTitle} — monitoring armed`;
  const html = shell(
    subject,
    `<h1 style="font-size:26px;margin:0 0 8px;color:#f4f1ea;">Monitoring armed ✓</h1>
<p style="font-size:15px;color:#a1a1aa;line-height:1.6;">Your watch for <strong style="color:#f4f1ea;">${escapeHtml(t.movieTitle)}</strong> is now actively monitoring ticket releases. Sit back — we've got opening night covered.</p>
${ctaButton(t.appUrl, "View my watch")}`,
  );
  return { subject, html };
}

export interface TicketsAvailableTemplate {
  movieTitle: string;
  theaterName: string;
  showtime: string;
  pricePerTicketCents: number;
  ticketCount: number;
  bookingUrl: string;
}

export function ticketsAvailableEmail(t: TicketsAvailableTemplate): {
  subject: string;
  html: string;
} {
  const subject = `Tickets found for ${t.movieTitle}!`;
  const html = shell(
    subject,
    `<h1 style="font-size:26px;margin:0 0 8px;color:#f4f1ea;">Tickets found! 🎟️</h1>
<p style="font-size:15px;color:#a1a1aa;line-height:1.6;">Seats matching your preferences for <strong style="color:#f4f1ea;">${escapeHtml(t.movieTitle)}</strong> just went live:</p>
<div style="background:#141416;border:1px solid #27272a;border-radius:16px;padding:20px 24px;margin:24px 0;">
  <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#f4f1ea;">${escapeHtml(t.theaterName)}</p>
  <p style="margin:0 0 6px;font-size:14px;color:#a1a1aa;">${escapeHtml(t.showtime)}</p>
  <p style="margin:0;font-size:14px;color:#a1a1aa;">${t.ticketCount} ticket${t.ticketCount === 1 ? "" : "s"} · <strong style="color:#e8b34b;">${money(t.pricePerTicketCents)}</strong> each</p>
</div>
<p style="font-size:14px;color:#a1a1aa;line-height:1.6;">These can sell out in minutes — grab them now.</p>
${ctaButton(t.bookingUrl, "Book now")}`,
  );
  return { subject, html };
}

export interface BookingConfirmedTemplate {
  movieTitle: string;
  theaterName: string;
  showtime: string;
  ticketCount: number;
  totalChargedCents: number;
  last4: string;
  appUrl: string;
}

export function bookingConfirmedEmail(t: BookingConfirmedTemplate): {
  subject: string;
  html: string;
} {
  const subject = `You're going to ${t.movieTitle}!`;
  const html = shell(
    subject,
    `<h1 style="font-size:26px;margin:0 0 8px;color:#f4f1ea;">You're going! 🍿</h1>
<p style="font-size:15px;color:#a1a1aa;line-height:1.6;">MovieWatch AI secured your seats for <strong style="color:#f4f1ea;">${escapeHtml(t.movieTitle)}</strong>:</p>
<div style="background:#141416;border:1px solid #27272a;border-radius:16px;padding:20px 24px;margin:24px 0;">
  <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#f4f1ea;">${escapeHtml(t.theaterName)}</p>
  <p style="margin:0 0 6px;font-size:14px;color:#a1a1aa;">${escapeHtml(t.showtime)}</p>
  <p style="margin:0 0 6px;font-size:14px;color:#a1a1aa;">${t.ticketCount} ticket${t.ticketCount === 1 ? "" : "s"}</p>
  <p style="margin:12px 0 0;padding-top:12px;border-top:1px solid #27272a;font-size:15px;color:#a1a1aa;">Charged: <strong style="color:#4ade80;">${money(t.totalChargedCents)}</strong> <span style="color:#71717a;">(card ···· ${escapeHtml(t.last4)})</span></p>
</div>
<p style="font-size:14px;color:#a1a1aa;line-height:1.6;">A receipt is on its way from the ticketing provider. Enjoy the show!</p>
${ctaButton(t.appUrl, "View my bookings")}`,
  );
  return { subject, html };
}

export interface PaymentFailedTemplate {
  movieTitle: string;
  amountCents: number;
  reason: string;
  appUrl: string;
}

export function paymentFailedEmail(t: PaymentFailedTemplate): { subject: string; html: string } {
  const subject = `Action needed: payment failed for ${t.movieTitle}`;
  const html = shell(
    subject,
    `<h1 style="font-size:26px;margin:0 0 8px;color:#f4f1ea;">Payment didn't go through</h1>
<p style="font-size:15px;color:#a1a1aa;line-height:1.6;">We found tickets for <strong style="color:#f4f1ea;">${escapeHtml(t.movieTitle)}</strong> but couldn't charge <strong style="color:#e8b34b;">${money(t.amountCents)}</strong>:</p>
<div style="background:#141416;border:1px solid rgba(248,113,113,0.35);border-radius:16px;padding:20px 24px;margin:24px 0;">
  <p style="margin:0;font-size:14px;color:#f87171;">${escapeHtml(t.reason)}</p>
</div>
<p style="font-size:14px;color:#a1a1aa;line-height:1.6;">Your watch is still armed — update your payment method and we'll retry on the next check.</p>
${ctaButton(t.appUrl, "Update payment method")}`,
  );
  return { subject, html };
}
