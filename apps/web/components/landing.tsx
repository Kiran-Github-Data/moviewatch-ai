"use client";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@moviewatch/ui";
import { WatchList } from "@/components/watch-list";
import { BellIcon, ShieldIcon, SparklesIcon, TicketIcon } from "@/components/icons";
import { GlassCard } from "@/components/ui-kit";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`text-xl font-bold tracking-tight ${className}`}>
      MovieWatch <span className="text-gold">AI</span>
    </span>
  );
}

const FEATURES = [
  {
    icon: <SparklesIcon className="h-6 w-6" />,
    title: "Ranked preferences",
    body: "First choice and backup for every dimension — theater, showtime, format, days. Your agent tries them in order.",
  },
  {
    icon: <BellIcon className="h-6 w-6" />,
    title: "Always-on monitoring",
    body: "Your watch agent checks ticket releases around the clock, polling faster as the release nears.",
  },
  {
    icon: <ShieldIcon className="h-6 w-6" />,
    title: "Guardrailed booking",
    body: "Hard spending limits you approve up front. Nothing books outside your max price, ever.",
  },
];

function FeatureCards() {
  return (
    <div className="mt-20 grid w-full grid-cols-1 gap-4 text-left md:grid-cols-3">
      {FEATURES.map((f, i) => (
        <motion.div
          key={f.title}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 + i * 0.12 }}
        >
          <GlassCard className="h-full p-7 transition-colors duration-300 hover:border-gold/25">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10 text-gold">
              {f.icon}
            </span>
            <h3 className="mt-5 text-lg font-bold tracking-tight">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{f.body}</p>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  );
}

function HeroCopy() {
  return (
    <>
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-gold"
      >
        <TicketIcon className="h-3.5 w-3.5" />
        AI ticket watch
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="max-w-4xl text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl"
      >
        Never miss a <span className="bg-gradient-to-br from-amber-200 to-amber-500 bg-clip-text text-transparent">premiere</span> again.
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="mt-6 max-w-xl text-lg leading-relaxed text-white/80"
      >
        Pick a future movie, rank your perfect theater, showtime, and seats — then forget
        about it. The moment tickets drop, your watch agent books them automatically,
        inside limits you approve.
      </motion.p>
    </>
  );
}

function CinematicBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(232,179,75,0.14),transparent_70%)]" />
      <div className="absolute inset-x-0 top-0 h-[50vh] bg-[radial-gradient(40%_35%_at_80%_10%,rgba(96,165,250,0.08),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_100%,transparent_40%,rgba(8,8,12,0.9)_100%)]" />
    </div>
  );
}

/** Rendered when Clerk is configured. */
export function LandingWithAuth() {
  return (
    <>
      <SignedOut>
        <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
          <CinematicBackdrop />
          <div className="relative">
            <HeroCopy />
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <SignInButton mode="modal">
                <Button
                  size="lg"
                  className="bg-gradient-to-br from-amber-300 to-amber-600 shadow-[0_8px_40px_rgba(232,179,75,0.35)] hover:brightness-110"
                >
                  Start watching — it&apos;s free
                </Button>
              </SignInButton>
              <Link href="/movies">
                <Button size="lg" variant="ghost">
                  Browse movies
                </Button>
              </Link>
            </motion.div>
            <div className="mx-auto max-w-5xl">
              <FeatureCards />
            </div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.8 }}
              className="mt-14 text-xs text-white/30"
            >
              This product uses the TMDB API but is not endorsed or certified by TMDB.
            </motion.p>
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
            <h1 className="text-4xl font-bold tracking-tight">Your watches</h1>
            <p className="mt-2 text-white/55">
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
      <CinematicBackdrop />
      <div className="relative">
        <HeroCopy />
        <div className="mx-auto mt-10 max-w-md rounded-3xl border border-amber-400/25 bg-amber-400/[0.07] px-6 py-4 text-sm text-amber-200">
          Authentication isn&apos;t configured yet — set{" "}
          <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
          </code>{" "}
          to enable sign-in.
        </div>
        <div className="mx-auto max-w-5xl">
          <FeatureCards />
        </div>
      </div>
    </main>
  );
}
