"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { MovieDetails } from "@moviewatch/contracts";
import { Button, EmptyState } from "@moviewatch/ui";
import { apiFetch, apiFetchWithAuth } from "@/lib/api";
import { useFreshToken } from "@/lib/use-fresh-token";
import { fetchMovieDetails } from "@/lib/movies";
import {
  DAY_LABELS,
  FORMAT_OPTIONS,
  TIME_WINDOW_PRESETS,
  ZONE_OPTIONS,
  ROW_OPTIONS,
  consentSummary,
  defaultPreference,
  formatDateShort,
  formatMoney,
  friendlyWatchError,
  type CreateWatchResponse,
  type PolicyTerms,
  type PreferenceInput,
  type TheaterT,
  type WatchT,
} from "@/lib/watches";
import { Logo } from "@/components/landing";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  DollarIcon,
  FilmIcon,
  MapPinIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
} from "@/components/icons";
import {
  Chip,
  Collapsible,
  FieldError,
  GlassCard,
  RankBadge,
  SelectedRing,
  Skeleton,
  SkeletonCard,
  StepHeading,
  StepProgress,
  Stepper,
  Toggle,
} from "@/components/ui-kit";

/* ============================== constants ============================== */

const STEPS = ["Movie", "Location", "Theaters", "Showtimes", "Formats", "Details", "Review"];

const WINDOW_META: Record<string, { label: string; hint: string }> = {
  morning: { label: "Morning", hint: "Before 12 PM" },
  afternoon: { label: "Afternoon", hint: "12 – 5 PM" },
  evening: { label: "Evening", hint: "5 – 10 PM" },
  "late-night": { label: "Late night", hint: "After 10 PM" },
};

const FORMAT_META: Record<string, { label: string; hint: string }> = {
  IMAX: { label: "IMAX", hint: "Giant screen, immersive sound" },
  XD: { label: "XD", hint: "Premium large-format screen" },
  Dolby: { label: "Dolby Cinema", hint: "Stunning HDR + Atmos audio" },
  Standard: { label: "Standard", hint: "Classic digital screening" },
};

const CUSTOM_WINDOW_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function defaultExpiry(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 60);
  return d.toISOString().slice(0, 10);
}

function kmToMiles(km: number | null): string | null {
  if (km === null) return null;
  const mi = km * 0.621371;
  return mi < 0.1 ? "<0.1 mi" : `${mi.toFixed(1)} mi`;
}

function windowLabel(w: string): string {
  return WINDOW_META[w]?.label ?? w;
}

/* ============================== small pieces ============================== */

function PreferenceRow({
  icon,
  label,
  rank1,
  rank2,
  emptyHint = "Any",
}: {
  icon: React.ReactNode;
  label: string;
  rank1: string[];
  rank2: string[];
  emptyHint?: string;
}) {
  return (
    <div className="flex items-start gap-4 py-4">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-gold">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">{label}</p>
        <div className="mt-2 space-y-1.5">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <RankBadge rank={1} />
            <span className="font-medium text-white">
              {rank1.length ? rank1.join(" · ") : emptyHint}
            </span>
          </p>
          {rank2.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <RankBadge rank={2} />
              <span className="text-white/70">{rank2.join(" · ")}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TermsSummary({ terms }: { terms: PolicyTerms }) {
  const rows: [string, string][] = [
    ["Max per ticket", formatMoney(terms.maxTicketPriceCents)],
    ["Max total", formatMoney(terms.maxTotalCents)],
    ["Tickets", String(terms.maxTickets)],
    ["Expires", formatDateShort(terms.expiresAt)],
  ];
  return (
    <dl className="divide-y divide-white/[0.06]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 px-6 py-3.5">
          <dt className="text-sm text-white/75">{k}</dt>
          <dd className="text-sm font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ============================== wizard ============================== */

export function WatchWizard() {
  const searchParams = useSearchParams();
  const getToken = useFreshToken();

  const tmdbId = useMemo(() => {
    const raw = searchParams.get("tmdbId");
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [searchParams]);
  const titleParam = searchParams.get("title") ?? "";
  const posterParam = searchParams.get("poster") ?? "";

  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState("");

  // Movie details for the cinematic hero
  const [details, setDetails] = useState<MovieDetails | null>(null);

  // Location + theaters
  const [zip, setZip] = useState("");
  const [zipTouched, setZipTouched] = useState(false);
  const [theaters, setTheaters] = useState<TheaterT[] | null>(null);
  const [theatersLoading, setTheatersLoading] = useState(false);
  const [theatersError, setTheatersError] = useState("");
  const [theaterRetry, setTheaterRetry] = useState(0);

  // Single per-dimension ranked preference
  const [pref, setPref] = useState<PreferenceInput>(() => defaultPreference());
  const [customWindow, setCustomWindow] = useState("");
  const [customWindowError, setCustomWindowError] = useState("");

  // Review / create / arm
  const [expiresDate, setExpiresDate] = useState(defaultExpiry);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateWatchResponse | null>(null);
  const [consent, setConsent] = useState(false);
  const [arming, setArming] = useState(false);
  const [armed, setArmed] = useState<WatchT | null>(null);
  const [apiError, setApiError] = useState("");

  const zipValid = /^\d{5}$/.test(zip.trim());

  /* Fetch movie details for the hero (public endpoint). */
  useEffect(() => {
    if (tmdbId === null) return;
    let cancelled = false;
    fetchMovieDetails(String(tmdbId))
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch(() => {
        /* hero falls back to poster param */
      });
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  /* Auto-fetch theaters when a valid ZIP is entered (public endpoint). */
  useEffect(() => {
    if (!zipValid) {
      setTheaters(null);
      setTheatersError("");
      return;
    }
    const z = zip.trim();
    let cancelled = false;
    setTheatersLoading(true);
    setTheatersError("");
    // Clear stale theater picks when ZIP changes.
    setPref((p) => ({ ...p, theatersRank1: [], theatersRank2: [] }));
    apiFetch<{ zip: string; theaters: TheaterT[] }>(`/theaters?zip=${z}`)
      .then((res) => {
        if (!cancelled) {
          setTheaters(res.theaters);
          setTheatersLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setTheatersLoading(false);
        setTheaters(null);
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("API 400")) setTheatersError("That ZIP code doesn't look right.");
        else if (msg.includes("API 502"))
          setTheatersError("Theater lookup is temporarily unavailable. Try again in a moment.");
        else setTheatersError("Couldn't load theaters. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [zipValid, zip, theaterRetry]);

  const theaterById = useCallback(
    (id: string) => theaters?.find((t) => t.id === id),
    [theaters],
  );

  /* ----- preference mutators ----- */
  const setP = <K extends keyof PreferenceInput>(k: K, v: PreferenceInput[K]) =>
    setPref((p) => ({ ...p, [k]: v }));
  const setSeat = (k: keyof PreferenceInput["seatRules"], v: string | number | boolean) =>
    setPref((p) => ({ ...p, seatRules: { ...p.seatRules, [k]: v } }));

  const toggleTheater = (id: string) => {
    setStepError("");
    setPref((p) => {
      if (p.theatersRank1.includes(id)) {
        // Deselect 1st → promote backup to 1st.
        return { ...p, theatersRank1: p.theatersRank2, theatersRank2: [] };
      }
      if (p.theatersRank2.includes(id)) return { ...p, theatersRank2: [] };
      if (p.theatersRank1.length === 0) return { ...p, theatersRank1: [id] };
      return { ...p, theatersRank2: [id] }; // replace backup
    });
  };

  /** Toggle a value in a rank group; a value can't be in both ranks. */
  const toggleRank = (
    key1: "timeWindowsRank1" | "formatsRank1" | "daysRank1",
    key2: "timeWindowsRank2" | "formatsRank2" | "daysRank2",
    rank: 1 | 2,
    value: string | number,
  ) => {
    setStepError("");
    setPref((p) => {
      const a = key1 as keyof PreferenceInput;
      const b = key2 as keyof PreferenceInput;
      const list1 = [...(p[a] as (string | number)[])];
      const list2 = [...(p[b] as (string | number)[])];
      if (rank === 1) {
        const i = list1.indexOf(value);
        if (i >= 0) list1.splice(i, 1);
        else {
          list1.push(value);
          const j = list2.indexOf(value);
          if (j >= 0) list2.splice(j, 1);
        }
      } else {
        const i = list2.indexOf(value);
        if (i >= 0) list2.splice(i, 1);
        else {
          list2.push(value);
          const j = list1.indexOf(value);
          if (j >= 0) list1.splice(j, 1);
        }
      }
      return { ...p, [a]: list1, [b]: list2 };
    });
  };

  const addCustomWindow = (rank: 1 | 2) => {
    const w = customWindow.trim();
    if (!CUSTOM_WINDOW_RE.test(w)) {
      setCustomWindowError("Use HH:MM–HH:MM, e.g. 19:30-22:00.");
      return;
    }
    const [start, end] = w.split("-");
    if (!start || !end || start >= end) {
      setCustomWindowError("Start time must be before end time.");
      return;
    }
    if (pref.timeWindowsRank1.includes(w) || pref.timeWindowsRank2.includes(w)) {
      setCustomWindowError("That window is already added.");
      return;
    }
    toggleRank("timeWindowsRank1", "timeWindowsRank2", rank, w);
    setCustomWindow("");
    setCustomWindowError("");
  };

  /* ----- validation ----- */
  const validateStep = (): string => {
    if (step === 1) {
      if (!zipValid) return "Enter a valid 5-digit ZIP code.";
      if (theatersLoading) return "Still loading theaters — one moment.";
      if (theatersError) return "Fix the theater lookup before continuing.";
      if (!theaters || theaters.length === 0)
        return "No theaters found near this ZIP. Try another.";
    }
    if (step === 2 && pref.theatersRank1.length === 0)
      return "Pick your first-choice theater to continue.";
    if (step === 3 && pref.timeWindowsRank1.length === 0)
      return "Pick at least one preferred showtime.";
    if (step === 4 && pref.formatsRank1.length === 0)
      return "Pick at least one preferred format.";
    if (step === 5) {
      if (pref.ticketCount < 1 || pref.ticketCount > 10) return "Ticket count must be 1–10.";
      if (pref.maxTicketPriceCents <= 0) return "Max price per ticket must be above $0.";
    }
    return "";
  };

  const next = () => {
    const err = validateStep();
    if (err) {
      setStepError(err);
      return;
    }
    setStepError("");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => {
    setStepError("");
    setStep((s) => Math.max(s - 1, 0));
  };

  /* ----- create + arm (fresh token per call, 401 retry inside apiFetchWithAuth) ----- */
  const createWatch = async () => {
    if (tmdbId === null) return;
    setCreating(true);
    setApiError("");
    try {
      const res = await apiFetchWithAuth<CreateWatchResponse>("/watches", getToken, {
        method: "POST",
        body: {
          tmdbId,
          movieTitle: details?.title || titleParam || `Movie ${tmdbId}`,
          zip: zip.trim(),
          expiresAt: new Date(`${expiresDate}T00:00:00Z`).toISOString(),
          preference: pref,
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
      const summary = consentSummary(created.policyPreview.terms);
      const watch = await apiFetchWithAuth<WatchT>(`/watches/${created.watch.id}/arm`, getToken, {
        method: "POST",
        body: {
          acceptedPolicyHash: created.policyPreview.termsHash,
          consent: { accepted: true, summary },
        },
      });
      setArmed(watch);
    } catch (err) {
      setApiError(friendlyWatchError(err));
    } finally {
      setArming(false);
    }
  };

  /* ----- no movie selected ----- */
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

  const movieTitle = details?.title || titleParam || `Movie #${tmdbId}`;
  const heroPoster = details?.posterUrl || posterParam;
  const heroBackdrop = details?.backdropUrl;

  /* ----- success state ----- */
  if (armed) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 shadow-[0_0_60px_rgba(232,179,75,0.4)]"
          >
            <CheckIcon className="h-12 w-12 text-black" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold">Watch armed</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              We&apos;re on it.
            </h1>
            <p className="mx-auto mt-4 max-w-md text-white/80">
              Your agent is now tracking ticket releases for{" "}
              <span className="font-semibold text-white">{armed.movieTitle}</span>. The moment
              your preferences match, we book — you just get the confirmation.
            </p>
          </motion.div>

          <GlassCard className="mt-10 p-6 text-left">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {heroPoster && (
                  <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg">
                    <Image src={heroPoster} alt="" fill sizes="56px" className="object-cover" />
                  </div>
                )}
                <div>
                  <p className="font-semibold">{armed.movieTitle}</p>
                  <p className="mt-1 text-sm text-white/75">
                    {armed.zip} · expires {formatDateShort(armed.expiresAt)}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                Monitoring
              </span>
            </div>
            {armed.preference && (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4 text-sm">
                <div>
                  <p className="text-xs text-white/70">Theater</p>
                  <p className="mt-0.5 font-medium">
                    {theaterById(armed.preference.theatersRank1[0] ?? "")?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-white/70">Tickets</p>
                  <p className="mt-0.5 font-medium">
                    {armed.preference.ticketCount} × up to{" "}
                    {formatMoney(armed.preference.maxTicketPriceCents)}
                  </p>
                </div>
              </div>
            )}
          </GlassCard>

          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/">
              <Button size="lg" className="w-full sm:w-auto">
                Go to dashboard
              </Button>
            </Link>
            <Link href="/movies">
              <Button size="lg" variant="ghost" className="w-full sm:w-auto">
                Watch another movie
              </Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/"><Logo /></Link>
        <Link
          href="/movies"
          className="inline-flex items-center gap-1.5 text-sm text-white/75 transition-colors hover:text-white"
        >
          <ArrowLeftIcon className="h-4 w-4" /> All movies
        </Link>
      </header>

      <StepProgress steps={STEPS} current={step} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -32 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          {/* ============ STEP 0 — Movie ============ */}
          {step === 0 && (
            <div>
              <div className="relative overflow-hidden rounded-3xl border border-white/[0.08]">
                {heroBackdrop ? (
                  <div className="relative h-64 sm:h-80">
                    <Image
                      src={heroBackdrop}
                      alt=""
                      fill
                      priority
                      sizes="(max-width: 768px) 100vw, 768px"
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#08080c] via-[#08080c]/55 to-[#08080c]/10" />
                  </div>
                ) : heroPoster ? (
                  <div className="relative h-64 overflow-hidden sm:h-80">
                    <Image
                      src={heroPoster}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 100vw, 768px"
                      className="scale-110 object-cover blur-2xl"
                    />
                    <div className="absolute inset-0 bg-[#08080c]/70" />
                  </div>
                ) : (
                  <div className="h-64 bg-gradient-to-br from-white/[0.06] to-transparent sm:h-80" />
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 p-6 sm:p-8">
                  {heroPoster && (
                    <div className="relative hidden h-44 w-32 shrink-0 overflow-hidden rounded-2xl border border-white/15 shadow-2xl sm:block">
                      <Image
                        src={heroPoster}
                        alt={`${movieTitle} poster`}
                        fill
                        sizes="128px"
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0 pb-1">
                    <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
                      <SparklesIcon className="h-3.5 w-3.5" /> New ticket watch
                    </p>
                    <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{movieTitle}</h1>
                    {details && (
                      <p className="mt-2 text-sm text-white/80">
                        {details.releaseDate
                          ? new Date(details.releaseDate).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                              timeZone: "UTC",
                            })
                          : "Release date TBA"}
                        {details.runtime ? ` · ${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m` : ""}
                        {details.genres.slice(0, 3).join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {!details && (
                <div className="mt-4 flex items-center gap-3 text-sm text-white/70">
                  <Skeleton className="h-4 w-48" />
                </div>
              )}
              <p className="mt-6 max-w-xl text-white/80">
                Tell us your perfect theater, showtime, and seats. Your AI agent watches
                releases around the clock and books the second tickets matching your
                preferences go live.
              </p>
            </div>
          )}

          {/* ============ STEP 1 — Location ============ */}
          {step === 1 && (
            <div>
              <StepHeading
                title="Where should we look?"
                subtitle="Enter your ZIP code and we'll pull up every theater nearby — no typing theater names by hand."
              />
              <GlassCard className="p-6 sm:p-8">
                <label htmlFor="zip" className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <MapPinIcon className="h-4 w-4 text-gold" /> ZIP code
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
                  autoComplete="postal-code"
                  className="w-48 rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 text-2xl font-semibold tracking-[0.3em] outline-none transition-colors placeholder:text-white/45 focus:border-gold/60"
                />
                <FieldError message={zipTouched && !zipValid ? "Enter a valid 5-digit ZIP code." : undefined} />

                <div className="mt-6">
                  {theatersLoading && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-sm text-white/75">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-gold" />
                        Finding theaters near {zip}…
                      </div>
                      <SkeletonCard lines={2} />
                    </div>
                  )}
                  {theatersError && (
                    <div className="rounded-2xl border border-red-400/25 bg-red-400/[0.07] px-5 py-4">
                      <p className="text-sm text-red-300">{theatersError}</p>
                      <button
                        type="button"
                        onClick={() => setTheaterRetry((n) => n + 1)}
                        className="mt-2 text-sm font-semibold text-gold hover:underline"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                  {theaters && !theatersLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] px-5 py-4"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
                        <BuildingIcon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-semibold">
                          {theaters.length} theater{theaters.length === 1 ? "" : "s"} found
                        </p>
                        <p className="text-sm text-white/55">
                          near {zip}, sorted by distance
                        </p>
                      </div>
                    </motion.div>
                  )}
                  {!zipValid && !theatersLoading && (
                    <p className="text-sm text-white/70">
                      Theaters load automatically once you enter a ZIP.
                    </p>
                  )}
                </div>
              </GlassCard>
            </div>
          )}

          {/* ============ STEP 2 — Theaters ============ */}
          {step === 2 && (
            <div>
              <StepHeading
                title="Pick your theaters"
                subtitle="Choose your first choice, then an optional backup. We'll try your first choice before falling back."
              />
              {theatersLoading ? (
                <div className="space-y-3">
                  <SkeletonCard lines={2} />
                  <SkeletonCard lines={2} />
                </div>
              ) : (
                <div className="space-y-3">
                  {theaters?.map((t, i) => {
                    const isRank1 = pref.theatersRank1.includes(t.id);
                    const isRank2 = pref.theatersRank2.includes(t.id);
                    const selected = isRank1 || isRank2;
                    return (
                      <motion.button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTheater(t.id)}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.05, 0.3) }}
                        whileTap={{ scale: 0.99 }}
                        aria-pressed={selected}
                        className={`relative w-full rounded-3xl border p-5 text-left transition-all duration-200 ${
                          isRank1
                            ? "border-gold/60 bg-gold/[0.08] shadow-[0_0_32px_rgba(232,179,75,0.12)]"
                            : isRank2
                              ? "border-white/25 bg-white/[0.05]"
                              : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                        }`}
                      >
                        <SelectedRing show={selected} gold={isRank1} />
                        <div className="flex items-start justify-between gap-4 pr-8">
                          <div className="min-w-0">
                            <p className="font-semibold">{t.name}</p>
                            <p className="mt-1 truncate text-sm text-white/75">
                              {[t.address, t.city].filter(Boolean).join(" · ") || "Address unavailable"}
                            </p>
                          </div>
                          {kmToMiles(t.distanceKm) && (
                            <span className="flex shrink-0 items-center gap-1 text-sm text-white/75">
                              <MapPinIcon className="h-4 w-4" />
                              {kmToMiles(t.distanceKm)}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex gap-2">
                          {isRank1 && <RankBadge rank={1} />}
                          {isRank2 && <RankBadge rank={2} />}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ============ STEP 3 — Showtimes ============ */}
          {step === 3 && (
            <div>
              <StepHeading
                title="When do you want to go?"
                subtitle="Pick your preferred showtime windows, then optional backups. We match showtimes inside these windows."
              />
              <RankGroup
                label="First choice"
                hint="We'll try these times first"
                rank={1}
              >
                <div className="flex flex-wrap gap-2">
                  {TIME_WINDOW_PRESETS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => toggleRank("timeWindowsRank1", "timeWindowsRank2", 1, w)}
                      aria-pressed={pref.timeWindowsRank1.includes(w)}
                      className={`rounded-2xl border px-5 py-3 text-left transition-all ${
                        pref.timeWindowsRank1.includes(w)
                          ? "border-gold/60 bg-gold/[0.1]"
                          : "border-white/10 bg-white/[0.02] hover:border-white/25"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {WINDOW_META[w]?.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-white/45">
                        {WINDOW_META[w]?.hint}
                      </span>
                    </button>
                  ))}
                  {pref.timeWindowsRank1
                    .filter((w) => !(TIME_WINDOW_PRESETS as readonly string[]).includes(w))
                    .map((w) => (
                      <CustomWindowChip
                        key={w}
                        value={w}
                        selected
                        onRemove={() => toggleRank("timeWindowsRank1", "timeWindowsRank2", 1, w)}
                      />
                    ))}
                </div>
              </RankGroup>

              <RankGroup label="Backup" hint="If nothing matches above, try these" rank={2}>
                <div className="flex flex-wrap gap-2">
                  {TIME_WINDOW_PRESETS.map((w) => (
                    <Chip
                      key={w}
                      selected={pref.timeWindowsRank2.includes(w)}
                      onClick={() => toggleRank("timeWindowsRank1", "timeWindowsRank2", 2, w)}
                    >
                      {WINDOW_META[w]?.label}
                    </Chip>
                  ))}
                  {pref.timeWindowsRank2
                    .filter((w) => !(TIME_WINDOW_PRESETS as readonly string[]).includes(w))
                    .map((w) => (
                      <CustomWindowChip
                        key={w}
                        value={w}
                        selected={false}
                        onRemove={() => toggleRank("timeWindowsRank1", "timeWindowsRank2", 2, w)}
                      />
                    ))}
                </div>
              </RankGroup>

              <div className="mt-6">
                <p className="mb-2 text-sm font-medium text-white/70">Custom window</p>
                <div className="flex max-w-md items-center gap-2">
                  <input
                    value={customWindow}
                    onChange={(e) => {
                      setCustomWindow(e.target.value);
                      setCustomWindowError("");
                    }}
                    placeholder="19:30-22:00"
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm outline-none placeholder:text-white/45 focus:border-gold/60"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => addCustomWindow(1)}>
                    Add
                  </Button>
                </div>
                <FieldError message={customWindowError || undefined} />
              </div>
            </div>
          )}

          {/* ============ STEP 4 — Formats ============ */}
          {step === 4 && (
            <div>
              <StepHeading
                title="Pick your formats"
                subtitle="Premium screens first, or keep it classic — rank what matters to you."
              />
              <RankGroup label="First choice" hint="Preferred formats" rank={1}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {FORMAT_OPTIONS.map((f) => {
                    const selected = pref.formatsRank1.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => toggleRank("formatsRank1", "formatsRank2", 1, f)}
                        aria-pressed={selected}
                        className={`relative rounded-3xl border p-5 text-left transition-all ${
                          selected
                            ? "border-gold/60 bg-gold/[0.08]"
                            : "border-white/[0.08] bg-white/[0.02] hover:border-white/25"
                        }`}
                      >
                        <SelectedRing show={selected} />
                        <p className="pr-8 font-semibold">{FORMAT_META[f]?.label ?? f}</p>
                        <p className="mt-1 text-sm text-white/75">{FORMAT_META[f]?.hint}</p>
                      </button>
                    );
                  })}
                </div>
              </RankGroup>
              <RankGroup label="Backup" hint="Acceptable if first choice sells out" rank={2}>
                <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map((f) => (
                    <Chip
                      key={f}
                      selected={pref.formatsRank2.includes(f)}
                      onClick={() => toggleRank("formatsRank1", "formatsRank2", 2, f)}
                    >
                      {f}
                    </Chip>
                  ))}
                </div>
              </RankGroup>
            </div>
          )}

          {/* ============ STEP 5 — Details ============ */}
          {step === 5 && (
            <div>
              <StepHeading
                title="The details"
                subtitle="Days, party size, budget, and seat preferences."
              />
              <div className="space-y-6">
                <GlassCard className="p-6">
                  <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
                    <CalendarIcon className="h-4 w-4 text-gold" /> Preferred days
                  </p>
                  <p className="mb-3 text-xs text-white/45">Leave empty for any day.</p>
                  <div className="flex flex-wrap gap-2">
                    {DAY_LABELS.map((label, i) => (
                      <Chip
                        key={label}
                        variant="gold"
                        selected={pref.daysRank1.includes(i)}
                        onClick={() => toggleRank("daysRank1", "daysRank2", 1, i)}
                      >
                        {label}
                      </Chip>
                    ))}
                  </div>
                  <p className="mb-3 mt-6 text-sm font-semibold text-white/70">Backup days</p>
                  <div className="flex flex-wrap gap-2">
                    {DAY_LABELS.map((label, i) => (
                      <Chip
                        key={label}
                        selected={pref.daysRank2.includes(i)}
                        onClick={() => toggleRank("daysRank1", "daysRank2", 2, i)}
                      >
                        {label}
                      </Chip>
                    ))}
                  </div>
                </GlassCard>

                <GlassCard className="grid grid-cols-1 gap-8 p-6 sm:grid-cols-2">
                  <Stepper
                    label="Tickets"
                    value={pref.ticketCount}
                    min={1}
                    max={10}
                    onChange={(v) => setP("ticketCount", v)}
                  />
                  <div>
                    <label
                      htmlFor="maxprice"
                      className="flex items-center gap-2 text-sm font-medium text-white/80"
                    >
                      <DollarIcon className="h-4 w-4" /> Max per ticket
                    </label>
                    <div className="relative mt-2 max-w-[200px]">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70">$</span>
                      <input
                        id="maxprice"
                        type="number"
                        min={1}
                        step="0.50"
                        value={(pref.maxTicketPriceCents / 100).toFixed(2)}
                        onChange={(e) => {
                          const dollars = Number(e.target.value);
                          if (!Number.isNaN(dollars) && dollars > 0)
                            setP("maxTicketPriceCents", Math.round(dollars * 100));
                        }}
                        className="w-full rounded-2xl border border-white/10 bg-black/40 py-2.5 pl-8 pr-4 text-lg font-semibold outline-none focus:border-gold/60"
                      />
                    </div>
                  </div>
                </GlassCard>

                <Collapsible
                  title="Advanced seat preferences"
                  subtitle="Zone, rows, adjacency and accessibility"
                >
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm text-white/55">Seating zone</span>
                      <select
                        value={pref.seatRules.zone}
                        onChange={(e) => setSeat("zone", e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm outline-none focus:border-gold/60"
                      >
                        {ZONE_OPTIONS.map((z) => (
                          <option key={z} value={z}>
                            {z.charAt(0).toUpperCase() + z.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm text-white/55">Rows</span>
                      <select
                        value={pref.seatRules.rows}
                        onChange={(e) => setSeat("rows", e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm outline-none focus:border-gold/60"
                      >
                        {ROW_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Stepper
                      label="Avoid front rows"
                      value={pref.seatRules.avoidFrontRows}
                      min={0}
                      max={10}
                      onChange={(v) => setSeat("avoidFrontRows", v)}
                    />
                    <div className="space-y-3">
                      <Toggle
                        checked={pref.seatRules.adjacencyRequired}
                        onChange={(v) => setSeat("adjacencyRequired", v)}
                        label="Seats together"
                        description="All tickets must be adjacent"
                      />
                      <Toggle
                        checked={pref.seatRules.accessibility}
                        onChange={(v) => setSeat("accessibility", v)}
                        label="Accessible seating"
                      />
                      <Toggle
                        checked={pref.seatRules.premiumFormatBias}
                        onChange={(v) => setSeat("premiumFormatBias", v)}
                        label="Prefer premium formats"
                        description="Favor IMAX / Dolby when tied"
                      />
                    </div>
                  </div>
                </Collapsible>
              </div>
            </div>
          )}

          {/* ============ STEP 6 — Review ============ */}
          {step === 6 && (
            <div>
              <StepHeading
                title="Review your watch"
                subtitle="Everything looks right? Create the watch, review the spending limits, then arm it."
              />
              <div className="mb-6 flex items-center gap-4">
                {heroPoster && (
                  <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10">
                    <Image src={heroPoster} alt="" fill sizes="64px" className="object-cover" />
                  </div>
                )}
                <div>
                  <p className="text-xl font-bold tracking-tight">{movieTitle}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-white/75">
                    <MapPinIcon className="h-4 w-4" /> {zip}
                  </p>
                </div>
              </div>

              <GlassCard className="divide-y divide-white/[0.06] px-6">
                <PreferenceRow
                  icon={<BuildingIcon className="h-4 w-4" />}
                  label="Theaters"
                  rank1={pref.theatersRank1.map((id) => theaterById(id)?.name ?? id)}
                  rank2={pref.theatersRank2.map((id) => theaterById(id)?.name ?? id)}
                  emptyHint="None selected"
                />
                <PreferenceRow
                  icon={<ClockIcon className="h-4 w-4" />}
                  label="Showtimes"
                  rank1={pref.timeWindowsRank1.map(windowLabel)}
                  rank2={pref.timeWindowsRank2.map(windowLabel)}
                />
                <PreferenceRow
                  icon={<FilmIcon className="h-4 w-4" />}
                  label="Formats"
                  rank1={pref.formatsRank1}
                  rank2={pref.formatsRank2}
                />
                <PreferenceRow
                  icon={<CalendarIcon className="h-4 w-4" />}
                  label="Days"
                  rank1={pref.daysRank1.map((d) => DAY_LABELS[d] ?? "")}
                  rank2={pref.daysRank2.map((d) => DAY_LABELS[d] ?? "")}
                />
                <PreferenceRow
                  icon={<UsersIcon className="h-4 w-4" />}
                  label="Party"
                  rank1={[
                    `${pref.ticketCount} ticket${pref.ticketCount === 1 ? "" : "s"} · up to ${formatMoney(pref.maxTicketPriceCents)} each`,
                  ]}
                  rank2={[]}
                  emptyHint=""
                />
              </GlassCard>

              <div className="mt-6">
                <label htmlFor="expires" className="mb-2 block text-sm font-medium text-white/70">
                  Stop watching on
                </label>
                <input
                  id="expires"
                  type="date"
                  value={expiresDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setExpiresDate(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm outline-none focus:border-gold/60 [color-scheme:dark]"
                />
              </div>

              {!created ? (
                <div className="mt-8">
                  <Button
                    size="lg"
                    onClick={createWatch}
                    disabled={creating}
                    className="bg-gradient-to-br from-amber-300 to-amber-600 shadow-[0_8px_32px_rgba(232,179,75,0.3)] hover:brightness-110"
                  >
                    {creating ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                        Creating watch…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <ZapIcon className="h-5 w-5" /> Create watch & show spending limits
                      </span>
                    )}
                  </Button>
                  {apiError && (
                    <p className="mt-3 text-sm text-red-400">{apiError}</p>
                  )}
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 space-y-6"
                >
                  <div>
                    <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                      <ShieldIcon className="h-5 w-5 text-gold" /> Spending authorization
                    </h2>
                    <GlassCard>
                      <TermsSummary terms={created.policyPreview.terms} />
                    </GlassCard>
                    <p className="mt-3 text-sm text-white/75">
                      MovieWatch AI may only book within these limits. Nothing is charged
                      until tickets matching your preferences are found.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-start gap-4 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:border-gold/40">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 accent-[#e8b34b]"
                    />
                    <span className="text-sm leading-relaxed text-white/70">
                      I authorize MovieWatch AI to book tickets within these limits:{" "}
                      <span className="font-medium text-white">
                        {consentSummary(created.policyPreview.terms)}
                      </span>
                    </span>
                  </label>
                  <div>
                    <Button
                      size="lg"
                      onClick={armWatch}
                      disabled={!consent || arming}
                      className="bg-gradient-to-br from-amber-300 to-amber-600 shadow-[0_8px_32px_rgba(232,179,75,0.3)] hover:brightness-110"
                    >
                      {arming ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                          Arming…
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <BellIcon className="h-5 w-5" /> Arm my watch
                        </span>
                      )}
                    </Button>
                    {apiError && <p className="mt-3 text-sm text-red-400">{apiError}</p>}
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {stepError && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6 flex items-center gap-2 text-sm text-red-400"
        >
          <XIcon className="h-4 w-4" /> {stepError}
        </motion.p>
      )}

      {/* Navigation */}
      {step < 6 && (
        <div className="mt-10 flex items-center justify-between">
          <Button variant="ghost" onClick={back} disabled={step === 0}>
            <span className="flex items-center gap-2">
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </span>
          </Button>
          <Button
            onClick={next}
            className="bg-gradient-to-br from-amber-300 to-amber-600 shadow-[0_8px_32px_rgba(232,179,75,0.25)] hover:brightness-110"
          >
            <span className="flex items-center gap-2">
              {step === 5 ? "Review" : "Continue"} <ArrowRightIcon className="h-4 w-4" />
            </span>
          </Button>
        </div>
      )}
      {step === 6 && !created && (
        <div className="mt-10">
          <Button variant="ghost" onClick={back}>
            <span className="flex items-center gap-2">
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </span>
          </Button>
        </div>
      )}
    </main>
  );
}

/* ============================== helpers ============================== */

function RankGroup({
  label,
  hint,
  rank,
  children,
}: {
  label: string;
  hint: string;
  rank: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        <RankBadge rank={rank} />
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-white/45">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function CustomWindowChip({
  value,
  selected,
  onRemove,
}: {
  value: string;
  selected: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium ${
        selected
          ? "bg-gradient-to-br from-amber-300 to-amber-500 text-black"
          : "border border-gold/40 bg-gold/10 text-gold"
      }`}
    >
      <ClockIcon className="h-3.5 w-3.5" />
      {value}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${value}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-black/20"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
