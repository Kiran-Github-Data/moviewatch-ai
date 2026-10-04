"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@moviewatch/ui";
import { CheckIcon, ChevronDownIcon, MinusIcon, PlusIcon, AlertIcon } from "./icons";

/* ---------- Glass card ---------- */
export function GlassCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl",
        "shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------- Selectable chip ---------- */
export function Chip({
  selected,
  onClick,
  children,
  variant = "default",
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "gold" | "outline";
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
        selected
          ? variant === "gold"
            ? "bg-gradient-to-br from-amber-300 to-amber-500 text-black shadow-[0_4px_16px_rgba(232,179,75,0.35)]"
            : "border-gold/60 bg-gold/15 text-gold"
          : "border border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25 hover:text-white",
        variant === "default" && "border",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

/* ---------- Number stepper ---------- */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div>
      <span className="text-sm font-medium text-white/80">{label}</span>
      <div className="mt-2 flex items-center gap-4">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/80 transition-all hover:border-gold/50 hover:text-gold disabled:opacity-25 disabled:hover:border-white/15 disabled:hover:text-white/80"
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        <span className="w-10 text-center text-2xl font-bold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/80 transition-all hover:border-gold/50 hover:text-gold disabled:opacity-25 disabled:hover:border-white/15 disabled:hover:text-white/80"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------- Toggle switch ---------- */
export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-1 text-left"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-white/75">{description}</span>}
      </span>
      <span
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-gradient-to-r from-amber-400 to-amber-600" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all duration-200",
            checked ? "left-6" : "left-1",
          )}
        />
      </span>
    </button>
  );
}

/* ---------- Rank badge (1st / 2nd) ---------- */
export function RankBadge({ rank }: { rank: 1 | 2 }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        rank === 1
          ? "bg-gradient-to-br from-amber-300 to-amber-500 text-black"
          : "border border-white/20 bg-white/10 text-white/80",
      )}
    >
      {rank === 1 ? "1st choice" : "2nd choice"}
    </span>
  );
}

/* ---------- Slim wizard progress ---------- */
export function StepProgress({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  const pct = ((current + 1) / steps.length) * 100;
  return (
    <div className="mb-10">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-semibold tracking-wide text-white">
          {steps[current]}
          <span className="ml-2 font-normal text-white/70">
            {current + 1} of {steps.length}
          </span>
        </p>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
      <div className="mt-2 flex justify-between">
        {steps.map((s, i) => (
          <span
            key={s}
            className={cn(
              "hidden text-[11px] sm:block",
              i === current ? "font-medium text-gold" : i < current ? "text-white/70" : "text-white/50",
            )}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Loading skeletons ---------- */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-gradient-to-r from-white/[0.04] via-white/[0.09] to-white/[0.04]",
        className,
      )}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="mt-3 h-4 w-full" />
      ))}
    </div>
  );
}

/* ---------- Inline error ---------- */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-sm text-red-400">
      <AlertIcon className="h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}

/* ---------- Collapsible section ---------- */
export function Collapsible({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-white/75">{subtitle}</span>}
        </span>
        <ChevronDownIcon
          className={cn("h-5 w-5 text-white/75 transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && <div className="border-t border-white/[0.06] px-6 py-5">{children}</div>}
    </div>
  );
}

/* ---------- Step heading ---------- */
export function StepHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {subtitle && <p className="mt-2 max-w-lg text-white/70">{subtitle}</p>}
    </div>
  );
}

/* ---------- Selection check overlay ---------- */
export function SelectedRing({ show, gold = true }: { show: boolean; gold?: boolean }) {
  if (!show) return null;
  return (
    <span
      className={cn(
        "absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full",
        gold ? "bg-gradient-to-br from-amber-300 to-amber-500 text-black" : "bg-white/20 text-white",
      )}
    >
      <CheckIcon className="h-4 w-4" />
    </span>
  );
}

/* ==================== signature effects (21st.dev-inspired) ==================== */

/* ---------- ShimmerButton: primary gold CTA with shimmer sweep ---------- */
export function ShimmerButton({
  children,
  onClick,
  disabled,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "mw-shimmer inline-flex items-center justify-center gap-2 rounded-full",
        "bg-gradient-to-br from-amber-300 to-amber-600 font-display font-semibold text-black",
        "shadow-[0_8px_32px_rgba(232,179,75,0.35)] transition-all duration-200",
        "hover:brightness-110 hover:shadow-[0_8px_40px_rgba(232,179,75,0.45)]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100",
        "px-7 py-3.5 text-base",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

/* ---------- BlurFade: blur-to-focus staggered entrance ---------- */
export function BlurFade({
  children,
  delay = 0,
  y = 20,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ---------- Spotlight: theatrical stage-lighting hero layers ---------- */
export function Spotlight({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div
        className="mw-spotlight absolute -top-[10%] left-[8%] h-[60vh] w-[42vw]"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(232,179,75,0.16), transparent 70%)",
        }}
      />
      <div
        className="mw-spotlight absolute -top-[16%] right-[4%] h-[52vh] w-[36vw]"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(232,179,75,0.1), transparent 70%)",
          animationDelay: "-7s",
          animationDuration: "18s",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[40vh]"
        style={{
          background:
            "linear-gradient(to top, var(--mw-bg) 0%, transparent 100%)",
        }}
      />
    </div>
  );
}

/* ---------- Scrim: legibility gradient over imagery ---------- */
export function Scrim({ className }: { className?: string }) {
  return <div aria-hidden className={cn("mw-scrim pointer-events-none absolute inset-0", className)} />;
}

/* ---------- CardSpotlight: cursor-tracked glow inside a card ---------- */
export function CardSpotlight({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ x: -400, y: -400 });
  const [active, setActive] = React.useState(false);

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      className={cn("group/spot relative overflow-hidden", className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{
          opacity: active ? 1 : 0,
          background: `radial-gradient(320px circle at ${pos.x}px ${pos.y}px, rgba(232,179,75,0.14), transparent 65%)`,
        }}
      />
      {children}
    </div>
  );
}

/* ---------- Marquee: infinite rail with edge fade ---------- */
export function Marquee({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mw-marquee-mask overflow-hidden", className)}>
      <div className="mw-marquee-track flex w-max gap-5">
        {children}
        {children}
      </div>
    </div>
  );
}

/* ---------- NumberTicker: animated count-up ---------- */
export function NumberTicker({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1200;
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={cn("tabular-nums", className)}>{display.toLocaleString()}</span>;
}

/* ---------- TheaterErrorState: designed empty/error state ---------- */
export function TheaterErrorState({
  message,
  onRetry,
  zip,
}: {
  message: string;
  onRetry: () => void;
  zip: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-white/[0.08] bg-black/60 p-8 text-center backdrop-blur-xl"
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/10 text-gold">
        <AlertIcon className="h-7 w-7" />
      </span>
      <h3 className="font-display mt-5 text-xl font-semibold tracking-tight">
        We couldn&apos;t load theaters
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/70">{message}</p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <ShimmerButton onClick={onRetry} className="!px-6 !py-2.5 !text-sm">
          Try again
        </ShimmerButton>
        <p className="text-xs text-white/70">
          Still stuck? Double-check the ZIP{" "}
          <span className="font-mono2 font-semibold text-white">{zip || "—"}</span> and retry.
        </p>
      </div>
    </motion.div>
  );
}
