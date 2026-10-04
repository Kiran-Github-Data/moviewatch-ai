import { cn } from "./utils";
import type { WatchStatus } from "@moviewatch/contracts";

const DOT: Record<string, string> = {
  MONITORING: "bg-[var(--mw-green)]",
  WAITING_FOR_RELEASE: "bg-[var(--mw-blue)]",
  TICKETS_DETECTED: "bg-[var(--mw-amber)]",
  BOOKED: "bg-[var(--mw-green)]",
  FAILED: "bg-[var(--mw-red)]",
  PAYMENT_FAILED: "bg-[var(--mw-red)]",
  SOLD_OUT: "bg-[var(--mw-red)]",
  USER_ACTION_REQUIRED: "bg-[var(--mw-amber)]",
  AUTHENTICATION_REQUIRED: "bg-[var(--mw-amber)]",
};

export function StatusBadge({ status, className }: { status: WatchStatus; className?: string }) {
  const dot = DOT[status] ?? "bg-[var(--mw-muted)]";
  const label = status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const pulse = status === "MONITORING" ? "animate-pulse" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide",
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dot, pulse)} />
      {label}
    </span>
  );
}
