"use client";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "@moviewatch/ui";
import { WatchList } from "@/components/watch-list";
import { BellIcon, ShieldIcon, SparklesIcon, TicketIcon, ArrowRightIcon } from "@/components/icons";
import { BlurFade, GlassCard, ShimmerButton, Spotlight } from "@/components/ui-kit";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-bold tracking-tight ${className}`}>
      MovieWatch <span className="text-gold">AI</span>
    </span>
  );
}

/* ---------- bento "how it works" ---------- */

const BENTO = [
  {
    icon: <SparklesIcon className="h-6 w-6" />,
    step: "01",
    title: "Rank your perfect night",
    body: "First choice and backup for every dimension — theater, showtime, format, days. Your agent tries them in order, exactly like you would.",
    span: "md:col-span-2",
  },
  {
    icon: <BellIcon className="h-6 w-6" />,
    step: "02",
    title: "AI watches releases",
    body: "Your watch agent checks ticket drops around the clock, polling faster as release nears.",
    span: "",
  },
  {
    icon: <ShieldIcon className="h-6 w-6" />,
    step: "03",
    title: "Guardrailed booking",
    body: "Hard spending limits you approve up front. Nothing books outside your max price, ever.",
    span: "",
  },
  {
    icon: <TicketIcon className="h-6 w-6" />,
    step: "04",
    title: "Tickets, secured",
    body: "The moment your preferences match, seats are booked and you're notified. You just show up.",
    span: "md:col-span-2",
  },
];

function BentoGrid() {
  return (
    <div className="mx-auto mt-24 w-full max-w-5xl text-left">
      <BlurFade>
        <p className="text-center text-xs font-bold uppercase tracking-[0.28em] text-gold">
          How it works
        </p>
        <h2 className="font-display mx-auto mt-4 max-w-2xl text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Set it once. We handle opening night.
        </h2>
      </BlurFade>
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {BENTO.map((b, i) => (
          <BlurFade key={b.step} delay={0.08 * i} className={b.span}>
            <GlassCard className="group h-full p-7 transition-all duration-300 hover:-translate-y-1 hover:border-gold/25 hover:shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
              <div className="flex items-start justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10 text-gold transition-transform duration-300 group-hover:scale-110">
                  {b.icon}
                </span>
                <span className="font-mono2 text-sm font-medium text-white/60">{b.step}</span>
              </div>
              <h3 className="font-display mt-6 text-lg font-semibold tracking-tight">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{b.body}</p>
            </GlassCard>
          </BlurFade>
        ))}
      </div>
    </div>
  );
}

/* ---------- hero ---------- */

function HeroCopy() {
  return (
    <>
      <BlurFade>
        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-gold">
          <TicketIcon className="h-3.5 w-3.5" />
          AI ticket watch
        </p>
      </BlurFade>
      <BlurFade delay={0.08}>
        <h1 className="font-display mx-auto max-w-4xl text-5xl font-bold leading-[1.04] tracking-tight md:text-7xl">
          Never miss a{" "}
          <span className="bg-gradient-to-br from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent">
            premiere
          </span>{" "}
          again.
        </h1>
      </BlurFade>
      <BlurFade delay={0.16}>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/70">
          Pick a future movie, rank your perfect theater, showtime, and seats — then
          forget about it. The moment tickets drop, your watch agent books them
          automatically, inside limits you approve.
        </p>
      </BlurFade>
    </>
  );
}

function HeroCtas() {
  return (
    <BlurFade delay={0.24}>
      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <SignInButton mode="modal">
          <ShimmerButton>
            Start watching — it&apos;s free
            <ArrowRightIcon className="h-4 w-4" />
          </ShimmerButton>
        </SignInButton>
        <Link href="/movies">
          <Button size="lg" variant="ghost" className="rounded-full px-7 py-3.5 text-base">
            Browse movies
          </Button>
        </Link>
      </div>
    </BlurFade>
  );
}

/** Rendered when Clerk is configured. */
export function LandingWithAuth() {
  return (
    <>
      <SignedOut>
        <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
          <Spotlight />
          <div className="relative">
            <HeroCopy />
            <HeroCtas />
            <BentoGrid />
            <BlurFade delay={0.1}>
              <p className="mt-16 text-xs text-white/60">
                This product uses the TMDB API but is not endorsed or certified by TMDB.
              </p>
            </BlurFade>
          </div>
        </main>
      </SignedOut>
      <SignedIn>
        <main className="relative mx-auto max-w-5xl px-6 py-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[40vh] bg-[radial-gradient(50%_40%_at_50%_0%,rgba(232,179,75,0.08),transparent_70%)]" aria-hidden />
          <header className="relative mb-10 flex items-center justify-between">
            <Logo />
            <div className="flex items-center gap-4">
              <Link href="/movies">
                <Button variant="ghost" size="sm">
                  Browse movies
                </Button>
              </Link>
              <UserButton afterSignOutUrl="/" />
            </div>
          </header>
          <div className="relative mb-8">
            <h1 className="font-display text-4xl font-bold tracking-tight">Your watches</h1>
            <p className="mt-2 text-white/70">
              Movies your AI agents are tracking right now.
            </p>
          </div>
          <div className="relative">
            <WatchList />
          </div>
        </main>
      </SignedIn>
    </>
  );
}

/** Rendered when Clerk keys are missing — marketing only, no crash. */
export function LandingNoAuth() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
      <Spotlight />
      <div className="relative">
        <HeroCopy />
        <div className="mx-auto mt-10 max-w-md rounded-3xl border border-amber-400/25 bg-amber-400/[0.07] px-6 py-4 text-sm text-amber-200">
          Authentication isn&apos;t configured yet — set{" "}
          <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono2 text-xs">
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
          </code>{" "}
          to enable sign-in.
        </div>
        <BentoGrid />
      </div>
    </main>
  );
}
