import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "@moviewatch/ui";
import { WatchList } from "@/components/watch-list";

export function Logo() {
  return (
    <span className="text-xl font-bold tracking-tight">
      MovieWatch <span className="text-gold">AI</span>
    </span>
  );
}

function FeatureCards() {
  return (
    <div className="mt-16 grid w-full grid-cols-1 gap-4 text-left md:grid-cols-3">
      {[
        ["🎯", "Your preferences", "Theater, day, showtime, format, seats, max price — two ranked options."],
        ["🤖", "AI monitoring", "Your watch agent checks ticket releases around the clock, faster as release nears."],
        ["🎟️", "Automatic booking", "Tickets secured the moment they match — you just get the confirmation."],
      ].map(([emoji, title, body]) => (
        <div key={title} className="rounded-2xl border border-white/10 bg-surface p-6">
          <div className="text-2xl">{emoji}</div>
          <h3 className="mt-3 font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted">{body}</p>
        </div>
      ))}
    </div>
  );
}

function HeroCopy() {
  return (
    <>
      <p className="mb-4 rounded-full border border-gold/30 bg-gold/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
        AI ticket watch
      </p>
      <h1 className="max-w-3xl text-5xl font-bold leading-tight tracking-tight md:text-6xl">
        Set it now. <span className="text-gold">We book it</span> the second tickets drop.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-muted">
        Pick a future movie, tell our AI your perfect theater, date, and seats — then forget
        about it. The moment tickets go live, your watch agent books them automatically.
      </p>
    </>
  );
}

/** Rendered when Clerk is configured. */
export function LandingWithAuth() {
  return (
    <>
      <SignedOut>
        <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">
          <HeroCopy />
          <div className="mt-10 flex gap-4">
            <SignInButton mode="modal">
              <Button size="lg">Start watching</Button>
            </SignInButton>
            <Link href="/sign-in">
              <Button size="lg" variant="ghost">
                Sign in
              </Button>
            </Link>
          </div>
          <FeatureCards />
        </main>
      </SignedOut>
      <SignedIn>
        <main className="mx-auto max-w-5xl px-6 py-10">
          <header className="mb-10 flex items-center justify-between">
            <Logo />
            <UserButton afterSignOutUrl="/" />
          </header>
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Your watches</h1>
            <p className="mt-1 text-muted">Movies your AI agents are tracking right now.</p>
          </div>
          <WatchList />
        </main>
      </SignedIn>
    </>
  );
}

/** Rendered when Clerk keys are missing — marketing only, no crash. */
export function LandingNoAuth() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">
      <HeroCopy />
      <div className="mt-10 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-6 py-4 text-sm text-amber-200">
        Authentication isn&apos;t configured yet — set{" "}
        <code className="rounded bg-black/40 px-1">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> to
        enable sign-in.
      </div>
      <FeatureCards />
    </main>
  );
}
