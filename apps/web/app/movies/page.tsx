import Link from "next/link";
import { EmptyState } from "@moviewatch/ui";
import { MovieCard } from "@/components/movie-card";
import { SearchBox } from "@/components/movie-search-box";
import { TmdbAttribution } from "@/components/tmdb-attribution";
import { Logo } from "@/components/landing";
import { fetchMovies, isDiscoveryNotConfigured, type BrowseTab } from "@/lib/movies";
import type { PagedMovies } from "@moviewatch/contracts";

const TABS: { id: BrowseTab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "trending", label: "Trending" },
  { id: "now-playing", label: "Now Playing" },
];

function NotConfigured() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10">
        <Link href="/"><Logo /></Link>
      </header>
      <EmptyState
        title="Movie discovery isn't configured yet"
        description="Set TMDB_READ_ACCESS_TOKEN (or TMDB_API_KEY) on the API server to browse upcoming releases. Get a key at themoviedb.org — a commercial agreement is required before launch."
      />
      <TmdbAttribution className="mt-8" />
    </main>
  );
}

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const tabParam = sp.tab ?? "upcoming";
  const tab: BrowseTab | "search" =
    tabParam === "search" || TABS.some((t) => t.id === tabParam) ? (tabParam as BrowseTab | "search") : "upcoming";
  const q = sp.q ?? "";
  const page = sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;

  let data: PagedMovies | null = null;
  let notConfigured = false;
  try {
    data = await fetchMovies(tab, { q, page });
  } catch (err) {
    if (isDiscoveryNotConfigured(err)) notConfigured = true;
    else throw err;
  }

  if (notConfigured) return <NotConfigured />;

  const heading =
    tab === "search" ? (q ? `Results for “${q}”` : "Search") : TABS.find((t) => t.id === tab)?.label;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Link href="/"><Logo /></Link>
        <SearchBox initial={tab === "search" ? q : ""} />
      </header>

      <div className="mb-8 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/movies?tab=${t.id}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-gold text-black"
                : "border border-white/10 bg-surface text-muted hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <h1 className="mb-6 text-2xl font-bold tracking-tight">{heading}</h1>

      {!data || data.movies.length === 0 ? (
        <EmptyState
          title={tab === "search" ? "No movies found" : "Nothing here yet"}
          description={
            tab === "search"
              ? "Try a different title."
              : "Check back soon — new releases appear as they're announced."
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.movies.map((m, i) => (
              <MovieCard key={m.tmdbId} movie={m} index={i} />
            ))}
          </div>
          <div className="mt-8 flex items-center justify-center gap-4">
            {page > 1 && (
              <Link
                href={`/movies?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page - 1}`}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:border-gold/40"
              >
                ← Previous
              </Link>
            )}
            <span className="text-sm text-muted">
              Page {data.page} of {data.totalPages}
            </span>
            {page < data.totalPages && (
              <Link
                href={`/movies?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page + 1}`}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:border-gold/40"
              >
                Next →
              </Link>
            )}
          </div>
        </>
      )}

      <TmdbAttribution className="mt-10 text-center" />
    </main>
  );
}
