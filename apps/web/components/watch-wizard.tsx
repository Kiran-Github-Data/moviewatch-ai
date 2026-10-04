"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Button, EmptyState, StatusBadge } from "@moviewatch/ui";
import { apiFetch } from "@/lib/api";
import {
  consentSummary,
  defaultPreference,
  formatDateShort,
  formatMoney,
  friendlyWatchError,
  type CreateWatchResponse,
  type PolicyTerms,
  type PreferenceInput,
  type WatchT,
} from "@/lib/watches";
import { PreferenceForm } from "@/components/preference-form";
import { Logo } from "@/components/landing";

const STEPS = ["Movie", "ZIP code", "Preference 1", "Preference 2", "Review & authorize"];

function defaultExpiry(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 60);
  return d.toISOString().slice(0, 10);
}

function preferenceErrors(p: PreferenceInput): string[] {
  const errs: string[] = [];
  if (p.theaterIds.length === 0) errs.push("Add at least one theater.");
  if (p.timeWindows.length === 0) errs.push("Pick at least one showtime window.");
  if (p.formats.length === 0) errs.push("Pick at least one format.");
  if (p.ticketCount < 1 || p.ticketCount > 10) errs.push("Ticket count must be 1–10.");
  if (p.maxTicketPriceCents <= 0) errs.push("Max price per ticket must be above $0.");
  return errs;
}

function TermsSummary({ terms }: { terms: PolicyTerms }) {
  const rows: [string, string][] = [
    ["Max per ticket", formatMoney(terms.maxTicketPriceCents)],
    ["Max total", formatMoney(terms.maxTotalCents)],
    ["Max tickets", String(terms.maxTickets)],
    ["Theaters", terms.allowedTheaterIds.join(", ") || "Any"],
    ["Authorization expires", formatDateShort(terms.expiresAt)],
  ];
  return (
    <dl className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-surface">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 px-5 py-3">
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="text-right text-sm font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewPreference({ p }: { p: PreferenceInput }) {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="rounded-2xl border border-white/10 bg-surface p-5 text-sm">
      <p className="mb-2 font-semibold text-gold">Preference {p.rank}</p>
      <ul className="space-y-1 text-white/80">
        <li>Theaters: {p.theaterIds.join(", ")}</li>
        <li>Days: {p.daysOfWeek.length ? p.daysOfWeek.map((d) => dayNames[d]).join(", ") : "Any"}</li>
        <li>Windows: {p.timeWindows.join(", ")}</li>
        <li>Formats: {p.formats.join(", ")}</li>
        <li>
          {p.ticketCount} ticket{p.ticketCount === 1 ? "" : "s"} · up to {formatMoney(p.maxTicketPriceCents)}{" "}
          each
        </li>
        <li>
          Seats: {p.seatRules.zone} zone, {p.seatRules.rows} rows
          {p.seatRules.adjacencyRequired ? ", adjacent" : ""}
          {p.seatRules.avoidFrontRows > 0 ? `, avoid front ${p.seatRules.avoidFrontRows}` : ""}
        </li>
      </ul>
    </div>
  );
}

export function WatchWizard() {
  const searchParams = useSearchParams();
  const { getToken } = useAuth();

  const tmdbId = useMemo(() => {
    const raw = searchParams.get("tmdbId");
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [searchParams]);
  const title = searchParams.get("title") ?? "";
  const poster = searchParams.get("poster") ?? "";

  const [step, setStep] = useState(0);
  const [zip, setZip] = useState("");
  const [zipTouched, setZipTouched] = useState(false);
  const [pref1, setPref1] = useState<PreferenceInput>(() => defaultPreference(1));
  const [pref2Enabled, setPref2Enabled] = useState(false);
  const [pref2, setPref2] = useState<PreferenceInput>(() => defaultPreference(2));
  const [expiresDate, setExpiresDate] = useState(defaultExpiry);
  const [stepError, setStepError] = useState("");

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateWatchResponse | null>(null);
  const [consent, setConsent] = useState(false);
  const [arming, setArming] = useState(false);
  const [armed, setArmed] = useState<WatchT | null>(null);
  const [apiError, setApiError] = useState("");

  const zipValid = /^\d{5}$/.test(zip.trim());

  if (tmdbId === null) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/"><Logo /></Link>
        <div className="mt-10">
          <EmptyState
            title="Pick a movie first"
            description="Choose an upcoming movie to start a ticket watch."
            action={
              <Link href="/movies">
                <Button>Browse movies</Button>
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  const canNext = (): string => {
    if (step === 1 && !zipValid) return "Enter a valid 5-digit ZIP code.";
    if (step === 2) {
      const errs = preferenceErrors(pref1);
      if (errs.length) return errs[0] ?? "Preference 1 has errors.";
    }
    if (step === 3 && pref2Enabled) {
      const errs = preferenceErrors(pref2);
      if (errs.length) return errs[0] ?? "Preference 2 has errors.";
    }
    return "";
  };

  const next = () => {
    const err = canNext();
    if (err) {
      setStepError(err);
      return;
    }
    setStepError("");
    // Skip the optional preference-2 step when disabled.
    setStep((s) => (s === 2 && !pref2Enabled ? 4 : s + 1));
  };
  const back = () => {
    setStepError("");
    setStep((s) => (s === 4 && !pref2Enabled ? 2 : s - 1));
  };

  const createWatch = async () => {
    setCreating(true);
    setApiError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("API 401 on /watches: session expired");
      const preferences = [pref1, ...(pref2Enabled ? [pref2] : [])];
      const res = await apiFetch<CreateWatchResponse>("/watches", {
        token,
        method: "POST",
        body: {
          tmdbId,
          movieTitle: title || `Movie ${tmdbId}`,
          zip: zip.trim(),
          expiresAt: new Date(`${expiresDate}T00:00:00Z`).toISOString(),
          preferences,
        },
      });
      setCreated(res);
    } catch (err) {
      setApiError(friendlyWatchError(err));
    } finally {
      setCreating(false);
    }
  };

  const armWatch = async () => {
    if (!created || !consent) return;
    setArming(true);
    setApiError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("API 401 on /watches: session expired");
      const summary = consentSummary(created.policyPreview.terms);
      const watch = await apiFetch<WatchT>(`/watches/${created.watch.id}/arm`, {
        token,
        method: "POST",
        body: {
          acceptedPolicyHash: created.policyPreview.termsHash,
          consent: { accepted: true, summary },
        },
      });
      setArmed(watch);
      setStep(5);
    } catch (err) {
      setApiError(friendlyWatchError(err));
    } finally {
      setArming(false);
    }
  };

  const visibleSteps = pref2Enabled ? STEPS : STEPS.filter((_, i) => i !== 3);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/"><Logo /></Link>
        <Link href="/movies" className="text-sm text-muted hover:text-white">
          ← All movies
        </Link>
      </header>

      {step < 5 && (
        <ol className="mb-10 flex items-center gap-2">
          {visibleSteps.map((label, i) => {
            const actualIndex = STEPS.indexOf(label);
            const done = step > actualIndex;
            const active = step === actualIndex;
            return (
              <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    done ? "bg-gold text-black" : active ? "border-2 border-gold text-gold" : "border border-white/15 text-muted"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={`hidden text-xs sm:block ${active ? "text-white" : "text-muted"}`}>
                  {label}
                </span>
                {i < visibleSteps.length - 1 && <span className="h-px flex-1 bg-white/10" />}
              </li>
            );
          })}
        </ol>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25 }}
        >
          {step === 0 && (
            <div>
              <h1 className="mb-6 text-2xl font-bold tracking-tight">New ticket watch</h1>
              <div className="flex items-center gap-5 rounded-2xl border border-white/10 bg-surface p-5">
                {poster ? (
                  <div className="relative h-36 w-24 shrink-0 overflow-hidden rounded-xl">
                    <Image src={poster} alt={`${title} poster`} fill sizes="96px" className="object-cover" />
                  </div>
                ) : null}
                <div>
                  <p className="text-lg font-semibold">{title || `Movie #${tmdbId}`}</p>
                  <Link href="/movies" className="mt-2 inline-block text-sm text-gold hover:underline">
                    Change movie →
                  </Link>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 className="mb-2 text-2xl font-bold tracking-tight">Where should we look?</h1>
              <p className="mb-6 text-muted">We&apos;ll match theaters near this ZIP code.</p>
              <label htmlFor="zip" className="mb-2 block text-sm font-medium">
                ZIP code
              </label>
              <input
                id="zip"
                inputMode="numeric"
                maxLength={5}
                value={zip}
                onChange={(e) => {
                  setZip(e.target.value.replace(/\D/g, "").slice(0, 5));
                  setZipTouched(true);
                  setStepError("");
                }}
                placeholder="75078"
                className="w-40 rounded-xl border border-white/10 bg-surface px-4 py-2.5 text-lg tracking-widest outline-none placeholder:text-muted focus:border-gold/50"
              />
              {zipTouched && !zipValid && (
                <p className="mt-2 text-sm text-red-400">Enter a valid 5-digit ZIP code.</p>
              )}
            </div>
          )}

          {step === 2 && (
            <PreferenceForm value={pref1} onChange={setPref1} title="Preference 1 — your ideal outing" />
          )}

          {step === 3 && (
            <div>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Backup preference?</h1>
                  <p className="mt-1 text-sm text-muted">
                    If your first choice sells out, we try this one.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pref2Enabled}
                  onClick={() => setPref2Enabled((v) => !v)}
                  className="flex items-center gap-3"
                >
                  <span className={`relative h-6 w-11 rounded-full transition-colors ${pref2Enabled ? "bg-gold" : "bg-white/15"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${pref2Enabled ? "left-[22px]" : "left-0.5"}`} />
                  </span>
                  <span className="text-sm">{pref2Enabled ? "On" : "Off"}</span>
                </button>
              </div>
              {pref2Enabled ? (
                <PreferenceForm value={pref2} onChange={setPref2} title="Preference 2 — your backup" />
              ) : (
                <p className="rounded-2xl border border-white/10 bg-surface p-6 text-sm text-muted">
                  Skipped — we&apos;ll only watch for your first preference. You can add a backup later.
                </p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-8">
              <div>
                <h1 className="mb-2 text-2xl font-bold tracking-tight">Review & authorize</h1>
                <p className="text-muted">
                  {title || `Movie #${tmdbId}`} · {zip}
                </p>
              </div>

              <div className="space-y-4">
                <ReviewPreference p={pref1} />
                {pref2Enabled && <ReviewPreference p={pref2} />}
              </div>

              <div>
                <label htmlFor="expires" className="mb-2 block text-sm font-medium">
                  Stop watching on
                </label>
                <input
                  id="expires"
                  type="date"
                  value={expiresDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setExpiresDate(e.target.value)}
                  className="rounded-xl border border-white/10 bg-surface px-4 py-2.5 text-sm outline-none focus:border-gold/50 [color-scheme:dark]"
                />
              </div>

              {!created ? (
                <div>
                  <Button size="lg" onClick={createWatch} disabled={creating}>
                    {creating ? "Creating watch…" : "Create watch & show spending limits"}
                  </Button>
                  {apiError && <p className="mt-3 text-sm text-red-400">{apiError}</p>}
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <h2 className="mb-3 text-lg font-semibold">Spending authorization</h2>
                    <TermsSummary terms={created.policyPreview.terms} />
                    <p className="mt-3 text-sm text-muted">
                      MovieWatch AI may only book within these limits. Nothing is charged until
                      tickets matching your preferences are found.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-surface p-5">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-1 h-5 w-5 accent-[#d4a017]"
                    />
                    <span className="text-sm leading-relaxed">
                      I authorize MovieWatch AI to book tickets within these limits:{" "}
                      <span className="font-medium text-white">
                        {consentSummary(created.policyPreview.terms)}
                      </span>
                    </span>
                  </label>
                  <div>
                    <Button size="lg" onClick={armWatch} disabled={!consent || arming}>
                      {arming ? "Arming…" : "Arm my watch"}
                    </Button>
                    {apiError && <p className="mt-3 text-sm text-red-400">{apiError}</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 5 && armed && (
            <div className="text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-4xl"
              >
                🎟️
              </motion.div>
              <h1 className="text-3xl font-bold tracking-tight">Your watch is armed</h1>
              <p className="mx-auto mt-3 max-w-md text-muted">
                We&apos;ll monitor ticket releases for{" "}
                <span className="font-medium text-white">{armed.movieTitle}</span> and book the
                moment your preferences match.
              </p>
              <div className="mx-auto mt-8 max-w-md">
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-surface px-5 py-4">
                  <span className="font-medium">{armed.movieTitle}</span>
                  <StatusBadge status={armed.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-left text-sm">
                  <div className="rounded-xl border border-white/10 bg-surface px-4 py-3">
                    <p className="text-muted">ZIP</p>
                    <p className="font-semibold">{armed.zip}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-surface px-4 py-3">
                    <p className="text-muted">Expires</p>
                    <p className="font-semibold">{formatDateShort(armed.expiresAt)}</p>
                  </div>
                </div>
              </div>
              <div className="mt-10 flex justify-center gap-4">
                <Link href="/">
                  <Button size="lg">Go to dashboard</Button>
                </Link>
                <Link href="/movies">
                  <Button size="lg" variant="ghost">
                    Watch another movie
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {stepError && step < 4 && <p className="mt-6 text-sm text-red-400">{stepError}</p>}

      {step < 4 && (
        <div className="mt-10 flex justify-between">
          <Button variant="ghost" onClick={back} disabled={step === 0}>
            ← Back
          </Button>
          <Button onClick={next}>Continue →</Button>
        </div>
      )}
      {step === 4 && !created && (
        <div className="mt-10 flex justify-start">
          <Button variant="ghost" onClick={back}>
            ← Back
          </Button>
        </div>
      )}
    </main>
  );
}
