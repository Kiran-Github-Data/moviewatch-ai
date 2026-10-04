import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState } from "@moviewatch/ui";
import { TmdbAttribution } from "@/components/tmdb-attribution";
import { Logo } from "@/components/landing";
import { fetchMovieDetails, isDiscoveryNotConfigured } from "@/lib/movies";

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
    <main className="pb-16">
      {/* Backdrop hero */}
      <div className="relative h-[38vh] min-h-[280px] w-full overflow-hidden">
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
          <div className="h-full w-full bg-surface" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent" />
        <div className="absolute left-6 top-6">
          <Link href="/movies" className="text-sm text-muted hover:text-white">← All movies</Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6">
        <div className="-mt-24 flex flex-col gap-6 md:flex-row">
          {details.posterUrl && (
            <div className="relative h-[300px] w-[200px] shrink-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
              <Image src={details.posterUrl} alt={`${details.title} poster`} fill sizes="200px" className="object-cover" />
            </div>
          )}
          <div className="flex flex-col justify-end pt-2 md:pt-24">
            <h1 className="text-4xl font-bold tracking-tight">{details.title}</h1>
            <p className="mt-2 text-muted">{formatDate(details.releaseDate)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {details.genres.map((g) => (
                <span key={g} className="rounded-full border border-white/10 bg-surface px-3 py-1 text-xs">
                  {g}
                </span>
              ))}
              {runtime && <span className="text-muted">{runtime}</span>}
              {details.voteAverage > 0 && (
                <span className="font-semibold text-gold">★ {details.voteAverage.toFixed(1)}</span>
              )}
            </div>
            <div className="mt-6">
              <Link
                href={`/watches/new?tmdbId=${details.tmdbId}&title=${encodeURIComponent(details.title)}${details.posterUrl ? `&poster=${encodeURIComponent(details.posterUrl)}` : ""}`}
              >
                <Button size="lg">Set up a ticket watch</Button>
              </Link>
              <p className="mt-2 text-xs text-muted">
                We&apos;ll watch for tickets and book automatically within your limits.
              </p>
            </div>
          </div>
        </div>

        {details.overview && (
          <section className="mt-10 max-w-3xl">
            <h2 className="mb-2 text-lg font-semibold">Overview</h2>
            <p className="leading-relaxed text-white/80">{details.overview}</p>
          </section>
        )}

        {details.trailerUrl && (
          <section className="mt-10 max-w-3xl">
            <h2 className="mb-3 text-lg font-semibold">Trailer</h2>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <iframe
                src={`https://www.youtube.com/embed/${details.trailerKey}`}
                title={`${details.title} trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="aspect-video w-full"
              />
            </div>
          </section>
        )}

        {details.cast.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold">Top cast</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {details.cast.map((c) => (
                <div key={c.id} className="overflow-hidden rounded-xl border border-white/10 bg-surface">
                  <div className="relative aspect-[3/4] w-full bg-white/5">
                    {c.profileUrl && (
                      <Image src={c.profileUrl} alt={c.name} fill sizes="150px" className="object-cover" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-semibold">{c.name}</p>
                    <p className="truncate text-xs text-muted">{c.character}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <TmdbAttribution className="mt-10" />
      </div>
    </main>
  );
}
