import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState } from "@moviewatch/ui";
import { TmdbAttribution } from "@/components/tmdb-attribution";
import { Logo } from "@/components/landing";
import { fetchMovieDetails, isDiscoveryNotConfigured } from "@/lib/movies";
import { ArrowLeftIcon, BellIcon, StarIcon } from "@/components/icons";
import { GlassCard } from "@/components/ui-kit";

function formatDate(iso: string | null): string {
  if (!iso) return "Release date TBA";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function formatRuntime(min: number | null): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function MovieDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let details = null;
  try {
    details = await fetchMovieDetails(id);
  } catch (err) {
    if (isDiscoveryNotConfigured(err)) {
      return (
        <main className="mx-auto max-w-5xl px-6 py-10">
          <Link href="/"><Logo /></Link>
          <div className="mt-10">
            <EmptyState
              title="Movie discovery isn't configured yet"
              description="Set TMDB_READ_ACCESS_TOKEN (or TMDB_API_KEY) on the API server."
            />
          </div>
        </main>
      );
    }
    if (err instanceof Error && err.message.includes("API 404")) notFound();
    throw err;
  }

  const runtime = formatRuntime(details.runtime);

  return (
    <main className="pb-20">
      {/* Backdrop hero */}
      <div className="relative h-[46vh] min-h-[340px] w-full overflow-hidden">
        {details.backdropUrl ? (
          <Image
            src={details.backdropUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-white/[0.06] to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/50 to-[#0a0a0b]/20" />
        <div className="absolute inset-x-0 top-0">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
            <Link href="/"><Logo /></Link>
            <Link
              href="/movies"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/70 backdrop-blur-md transition-colors hover:border-white/25 hover:text-white"
            >
              <ArrowLeftIcon className="h-4 w-4" /> All movies
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <div className="-mt-28 flex flex-col gap-8 md:flex-row">
          {details.posterUrl && (
            <div className="relative h-[330px] w-[220px] shrink-0 overflow-hidden rounded-3xl border border-white/15 shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
              <Image src={details.posterUrl} alt={`${details.title} poster`} fill sizes="220px" className="object-cover" />
            </div>
          )}
          <div className="flex min-w-0 flex-col justify-end md:pb-2 md:pt-28">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{details.title}</h1>
            <p className="mt-3 text-white/70">{formatDate(details.releaseDate)}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {details.genres.map((g) => (
                <span key={g} className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm">
                  {g}
                </span>
              ))}
              {runtime && (
                <span className="px-1 text-sm tabular-nums text-white/70">{runtime}</span>
              )}
              {details.voteAverage > 0 && (
                <span className="inline-flex items-center gap-1.5 font-bold text-gold">
                  <StarIcon className="h-4 w-4" />
                  {details.voteAverage.toFixed(1)}
                </span>
              )}
            </div>
            <div className="mt-7">
              <Link
                href={`/watches/new?tmdbId=${details.tmdbId}&title=${encodeURIComponent(details.title)}${details.posterUrl ? `&poster=${encodeURIComponent(details.posterUrl)}` : ""}`}
              >
                <Button
                  size="lg"
                  className="bg-gradient-to-br from-amber-300 to-amber-600 shadow-[0_8px_40px_rgba(232,179,75,0.35)] hover:brightness-110"
                >
                  <span className="flex items-center gap-2">
                    <BellIcon className="h-5 w-5" /> Set up a ticket watch
                  </span>
                </Button>
              </Link>
              <p className="mt-3 text-sm text-white/70">
                We&apos;ll watch for tickets and book automatically within your limits.
              </p>
            </div>
          </div>
        </div>

        {details.overview && (
          <section className="mt-12 max-w-3xl">
            <h2 className="mb-3 text-xl font-bold tracking-tight">Overview</h2>
            <p className="text-[17px] leading-relaxed text-white/70">{details.overview}</p>
          </section>
        )}

        {details.trailerUrl && (
          <section className="mt-12 max-w-4xl">
            <h2 className="mb-4 text-xl font-bold tracking-tight">Trailer</h2>
            <GlassCard className="overflow-hidden !rounded-3xl">
              <iframe
                src={`https://www.youtube.com/embed/${details.trailerKey}`}
                title={`${details.title} trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="aspect-video w-full"
              />
            </GlassCard>
          </section>
        )}

        {details.cast.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-bold tracking-tight">Top cast</h2>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
              {details.cast.map((c) => (
                <div
                  key={c.id}
                  className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-white/[0.04]">
                    {c.profileUrl && (
                      <Image
                        src={c.profileUrl}
                        alt={c.name}
                        fill
                        sizes="150px"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-xs font-semibold">{c.name}</p>
                    <p className="mt-0.5 truncate text-xs text-white/70">{c.character}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <TmdbAttribution className="mt-12" />
      </div>
    </main>
  );
}
