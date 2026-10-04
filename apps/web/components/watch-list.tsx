"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button, EmptyState, StatusBadge } from "@moviewatch/ui";
import { apiFetchWithAuth } from "@/lib/api";
import { useFreshToken } from "@/lib/use-fresh-token";
import {
  DAY_LABELS,
  formatDateShort,
  formatMoney,
  friendlyWatchError,
  type PreferenceInput,
  type WatchT,
} from "@/lib/watches";
import {
  CalendarIcon,
  MapPinIcon,
  PlusIcon,
  TicketIcon,
  ZapIcon,
} from "@/components/icons";
import { GlassCard, NumberTicker, RankBadge, SkeletonCard } from "@/components/ui-kit";

const TERMINAL = new Set(["BOOKED", "CANCELLED", "FAILED", "EXPIRED"]);
const DISARMABLE = new Set(["ARMED", "MONITORING", "WAITING_FOR_RELEASE"]);

const WINDOW_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  "late-night": "Late night",
};

function DimBadge({ label, rank1, rank2 }: { label: string; rank1: string; rank2?: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-16 shrink-0 pt-0.5 font-semibold uppercase tracking-wider text-white/70">
        {label}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-white">{rank1}</p>
        {rank2 && <p className="truncate text-white/70">{rank2}</p>}
      </div>
    </div>
  );
}

function PreferenceSummary({ p }: { p: PreferenceInput }) {
  const days1 = p.daysRank1.map((d) => DAY_LABELS[d]).join(", ") || "Any day";
  const days2 = p.daysRank2.map((d) => DAY_LABELS[d]).join(", ");
  const win1 = p.timeWindowsRank1.map((w) => WINDOW_LABELS[w] ?? w).join(" · ") || "Any time";
  const win2 = p.timeWindowsRank2.map((w) => WINDOW_LABELS[w] ?? w).join(" · ");
  const fmt1 = p.formatsRank1.join(" · ") || "Any format";
  const fmt2 = p.formatsRank2.join(" · ");
  return (
    <div className="mt-4 space-y-2.5 border-t border-white/[0.06] pt-4">
      <DimBadge label="Theaters" rank1={`${p.theatersRank1.length} first choice`} rank2={p.theatersRank2.length ? `${p.theatersRank2.length} backup` : undefined} />
      <DimBadge label="Showtime" rank1={win1} rank2={win2 || undefined} />
      <DimBadge label="Format" rank1={fmt1} rank2={fmt2 || undefined} />
      <DimBadge label="Days" rank1={days1} rank2={days2 || undefined} />
      <DimBadge
        label="Party"
        rank1={`${p.ticketCount} ticket${p.ticketCount === 1 ? "" : "s"} · up to ${formatMoney(p.maxTicketPriceCents)} each`}
      />
    </div>
  );
}

function WatchCard({
  watch,
  acting,
  onAct,
  index,
}: {
  watch: WatchT;
  acting: string | null;
  onAct: (id: string, action: "disarm" | "cancel") => void;
  index: number;
}) {
  const terminal = TERMINAL.has(watch.status);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.06, 0.3) }}
    >
      <GlassCard className="group p-6 transition-colors duration-200 hover:border-white/[0.16]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-bold tracking-tight">{watch.movieTitle}</h3>
              <StatusBadge status={watch.status} />
              {watch.autoBookEnabled && (
                <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold">
                  <ZapIcon className="h-3 w-3" /> Auto-book
                </span>
              )}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/70">
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="h-3.5 w-3.5" /> {watch.zip}
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarIcon className="h-3.5 w-3.5" /> Expires {formatDateShort(watch.expiresAt)}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {DISARMABLE.has(watch.status) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={acting === `disarm:${watch.id}`}
                onClick={() => onAct(watch.id, "disarm")}
              >
                {acting === `disarm:${watch.id}` ? "Disarming…" : "Disarm"}
              </Button>
            )}
            {!terminal && (
              <Button
                size="sm"
                variant="danger"
                disabled={acting === `cancel:${watch.id}`}
                onClick={() => onAct(watch.id, "cancel")}
              >
                {acting === `cancel:${watch.id}` ? "Cancelling…" : "Cancel"}
              </Button>
            )}
          </div>
        </div>

        {watch.preference ? (
          <PreferenceSummary p={watch.preference} />
        ) : (
          <p className="mt-4 text-sm text-white/70">No preferences saved.</p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
          <div className="flex items-center gap-2 text-xs text-white/70">
            <RankBadge rank={1} />
            <span>tried before</span>
            <RankBadge rank={2} />
            <span>backup</span>
          </div>
          <Link
            href={`/watches/new?tmdbId=${watch.tmdbId}&title=${encodeURIComponent(watch.movieTitle)}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-gold/80 transition-colors hover:text-gold"
          >
            <PlusIcon className="h-3.5 w-3.5" /> New watch, same movie
          </Link>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export function WatchList() {
  const getToken = useFreshToken();
  const [watches, setWatches] = useState<WatchT[] | null>(null);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await apiFetchWithAuth<{ watches: WatchT[] }>("/watches", getToken);
      setWatches(res.watches);
    } catch (err) {
      setError(friendlyWatchError(err));
      setWatches([]);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "disarm" | "cancel") => {
    setActing(`${action}:${id}`);
    setError("");
    try {
      await apiFetchWithAuth(`/watches/${id}/${action}`, getToken, { method: "POST" });
      await load();
    } catch (err) {
      setError(friendlyWatchError(err));
    } finally {
      setActing(null);
    }
  };

  if (watches === null) {
    return (
      <div className="space-y-4">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    );
  }

  const active = watches.filter((w) => !TERMINAL.has(w.status));

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-2xl border border-red-400/30 bg-red-400/10 px-5 py-3.5 text-sm text-red-300">
          {error}
        </p>
      )}

      {watches.length === 0 ? (
        <EmptyState
          title="No watches yet"
          description="Pick an upcoming movie and tell your AI agent exactly what you want. It will handle the rest."
          action={
            <Link href="/movies">
              <Button>Browse upcoming movies</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* status-first summary */}
          <GlassCard className="mb-6 flex flex-wrap items-center gap-x-10 gap-y-4 p-6">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10 text-gold">
                <TicketIcon className="h-6 w-6" />
              </span>
              <div>
                <p className="font-display text-3xl font-bold tabular-nums">
                  <NumberTicker value={active.length} />
                </p>
                <p className="text-xs font-medium uppercase tracking-wider text-white/70">
                  active {active.length === 1 ? "watch" : "watches"}
                </p>
              </div>
            </div>
            <div className="h-10 w-px bg-white/[0.08]" aria-hidden />
            <div>
              <p className="font-display text-3xl font-bold tabular-nums">
                <NumberTicker value={watches.length - active.length} />
              </p>
              <p className="text-xs font-medium uppercase tracking-wider text-white/70">
                completed
              </p>
            </div>
            <div className="ml-auto">
              <Link href="/movies">
                <Button variant="ghost" size="sm">
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4" /> New watch
                  </span>
                </Button>
              </Link>
            </div>
          </GlassCard>

          <div className="space-y-5">
            {watches.map((w, i) => (
              <WatchCard key={w.id} watch={w} acting={acting} onAct={act} index={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
