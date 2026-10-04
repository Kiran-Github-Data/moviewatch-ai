"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetchWithAuth, type TokenGetter } from "@/lib/api";
import { useFreshToken } from "@/lib/use-fresh-token";
import { GlassCard, ShimmerButton, Skeleton } from "./ui-kit";
import { CheckIcon, PlusIcon, ShieldIcon, XIcon, AlertIcon } from "./icons";

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

interface PaymentSetupProps {
  /** Compact mode for embedding in the wizard (no page heading). */
  compact?: boolean;
  /** Pre-selected card id (wizard). */
  selectedId?: string | null;
  /** Called when selection changes (wizard). */
  onSelect?: (id: string | null) => void;
}

/**
 * Saved cards for auto-booking. "Add card" opens a Stripe Checkout session
 * (setup mode) — raw card numbers never touch our servers.
 */
export function PaymentSetup({ compact, selectedId, onSelect }: PaymentSetupProps) {
  const getToken = useFreshToken();
  const searchParams = useSearchParams();
  const [cards, setCards] = useState<SavedCard[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetchWithAuth<{ methods: SavedCard[] }>(
        "/payments/methods",
        getToken,
      );
      setCards(res.methods);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load saved cards.");
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Return from Stripe Checkout.
  useEffect(() => {
    const status = searchParams.get("payment");
    if (status === "added") void load();
  }, [searchParams, load]);

  const addCard = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetchWithAuth<{ checkoutUrl: string }>(
        "/payments/setup",
        getToken,
        { method: "POST" },
      );
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start card setup.");
      setBusy(false);
    }
  };

  const removeCard = async (id: string) => {
    setDeletingId(id);
    setError("");
    try {
      await apiFetchWithAuth(`/payments/methods/${id}`, getToken, { method: "DELETE" });
      setCards((prev) => (prev ?? []).filter((c) => c.id !== id));
      if (selectedId === id) onSelect?.(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the card.");
    } finally {
      setDeletingId(null);
    }
  };

  const paymentStatus = searchParams.get("payment");

  return (
    <div>
      {!compact && (
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ShieldIcon className="h-5 w-5 text-gold" /> Payment methods
          </h2>
          <p className="mt-1 text-sm text-white/75">
            Cards are stored securely by Stripe and only charged when you explicitly
            authorize auto-booking for a watch.
          </p>
        </div>
      )}

      {paymentStatus === "added" && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
          <CheckIcon className="h-4 w-4" /> Card added successfully.
        </p>
      )}
      {paymentStatus === "cancelled" && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/75">
          <AlertIcon className="h-4 w-4" /> Card setup was cancelled — no card was saved.
        </p>
      )}

      {cards === null ? (
        <Skeleton className="h-20 rounded-2xl" />
      ) : cards.length === 0 ? (
        <GlassCard className="p-5 text-center">
          <p className="text-sm text-white/75">No cards saved yet.</p>
          <p className="mt-1 text-xs text-white/70">
            Add a card to enable one-tap auto-booking when tickets drop.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => {
            const selected = selectedId === c.id;
            return (
              <div
                key={c.id}
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={() => onSelect?.(selected ? null : c.id)}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelect(selected ? null : c.id);
                  }
                }}
                className={`flex items-center gap-3 rounded-2xl border p-4 transition-colors ${
                  onSelect ? "cursor-pointer" : ""
                } ${
                  selected
                    ? "border-gold/60 bg-gold/[0.07]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
              >
                <div
                  className={`flex h-10 w-14 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-bold uppercase ${
                    selected ? "bg-gold text-black" : "bg-white/10 text-white/80"
                  }`}
                >
                  {c.brand}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold tracking-wider">
                    •••• {c.last4}
                  </p>
                  <p className="text-xs text-white/70">
                    Expires {String(c.expMonth).padStart(2, "0")}/{c.expYear}
                    {c.isDefault && <span className="ml-2 text-gold">Default</span>}
                  </p>
                </div>
                {onSelect && selected && <CheckIcon className="h-5 w-5 shrink-0 text-gold" />}
                <button
                  type="button"
                  aria-label={`Remove card ending in ${c.last4}`}
                  disabled={deletingId === c.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeCard(c.id);
                  }}
                  className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4">
        <ShimmerButton onClick={addCard} disabled={busy} className="!px-6 !py-3 !text-sm">
          {busy ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
              Opening secure checkout…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <PlusIcon className="h-4 w-4" /> {cards && cards.length > 0 ? "Add another card" : "Add a card"}
            </span>
          )}
        </ShimmerButton>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-white/70">
          <ShieldIcon className="h-3.5 w-3.5" /> Secured by Stripe — we never see your card number.
        </p>
      </div>
    </div>
  );
}

/** Hook-free loader for places that already manage tokens. */
export async function fetchSavedCards(getToken: TokenGetter): Promise<SavedCard[]> {
  const res = await apiFetchWithAuth<{ methods: SavedCard[] }>("/payments/methods", getToken);
  return res.methods;
}
