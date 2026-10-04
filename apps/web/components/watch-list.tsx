"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Button, EmptyState, StatusBadge } from "@moviewatch/ui";
import { apiFetch } from "@/lib/api";
import {
  DAY_LABELS,
  formatDateShort,
  formatMoney,
  friendlyWatchError,
  type WatchT,
} from "@/lib/watches";

const TERMINAL = new Set(["BOOKED", "CANCELLED", "FAILED", "EXPIRED"]);
const DISARMABLE = new Set(["ARMED", "MONITORING", "WAITING_FOR_RELEASE"]);

function preferenceLine(w: WatchT): string {
  const p = w.preferences[0];
  if (!p) return "No preferences";
  const days = p.daysOfWeek.length ? p.daysOfWeek.map((d) => DAY_LABELS[d]).join(", ") : "any day";
  const bits = [
    `${p.ticketCount} ticket${p.ticketCount === 1 ? "" : "s"}`,
    p.formats.join("/") || "any format",
    days,
    `up to ${formatMoney(p.maxTicketPriceCents)} each`,
  ];
  if (w.preferences.length > 1) bits.push(`+${w.preferences.length - 1} backup`);
  return bits.join(" · ");
}

export function WatchList() {
  const { getToken } = useAuth();
  const [watches, setWatches] = useState<WatchT[] | null>(null);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("API 401 on /watches: session expired");
      const res = await apiFetch<{ watches: WatchT[] }>("/watches", { token });
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
      const token = await getToken();
      if (!token) throw new Error("API 401 on /watches: session expired");
      await apiFetch(`/watches/${id}/${action}`, { token, method: "POST" });
      await load();
    } catch (err) {
      setError(friendlyWatchError(err));
    } finally {
      setActing(null);
    }
  };

  if (watches === null) {
    return <p className="text-muted">Loading your watches…</p>;
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
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
        <div className="space-y-4">
          {watches.map((w) => (
            <div
              key={w.id}
              className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="truncate text-lg font-semibold">{w.movieTitle}</h3>
                  <StatusBadge status={w.status} />
                </div>
                <p className="mt-1 text-sm text-muted">{preferenceLine(w)}</p>
                <p className="mt-1 text-xs text-muted">
                  {w.zip} · expires {formatDateShort(w.expiresAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {DISARMABLE.has(w.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={acting === `disarm:${w.id}`}
                    onClick={() => act(w.id, "disarm")}
                  >
                    {acting === `disarm:${w.id}` ? "Disarming…" : "Disarm"}
                  </Button>
                )}
                {!TERMINAL.has(w.status) && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={acting === `cancel:${w.id}`}
                    onClick={() => act(w.id, "cancel")}
                  >
                    {acting === `cancel:${w.id}` ? "Cancelling…" : "Cancel"}
                  </Button>
                )}
                <Link href={`/watches/new?tmdbId=${w.tmdbId}&title=${encodeURIComponent(w.movieTitle)}`}>
                  <Button size="sm" variant="ghost">
                    New watch
                  </Button>
                </Link>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Link href="/movies">
              <Button variant="ghost">+ Watch another movie</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
