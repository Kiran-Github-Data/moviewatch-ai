import Link from "next/link";
import { EmptyState } from "@moviewatch/ui";
import { MovieCard } from "@/components/movie-card";
import { SearchBox } from "@/components/movie-search-box";
import { TmdbAttribution } from "@/components/tmdb-attribution";
import { Logo } from "@/components/landing";
import { fetchMovies, isDiscoveryNotConfigured, type BrowseTab } from "@/lib/movies";
import type { PagedMovies } from "@moviewatch/contracts";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";

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
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[30vh] bg-[radial-gradient(50%_40%_at_50%_0%,rgba(232,179,75,0.07),transparent_70%)]" aria-hidden />
      <header className="relative mb-10 flex flex-wrap items-center justify-between gap-4">
        <Link href="/"><Logo /></Link>
        <SearchBox initial={tab === "search" ? q : ""} />
      </header>

      <div className="relative mb-10 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/movies?tab=${t.id}`}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 ${
              tab === t.id
                ? "bg-gradient-to-br from-amber-300 to-amber-500 text-black shadow-[0_4px_20px_rgba(232,179,75,0.3)]"
                : "border border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <h1 className="relative mb-8 text-3xl font-bold tracking-tight">{heading}</h1>

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
          <div className="relative grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.movies.map((m, i) => (
              <MovieCard key={m.tmdbId} movie={m} index={i} />
            ))}
          </div>
          <div className="mt-10 flex items-center justify-center gap-4">
            {page > 1 && (
              <Link
                href={`/movies?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page - 1}`}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium transition-all hover:border-gold/40 hover:text-gold"
              >
                <ArrowLeftIcon className="h-4 w-4" /> Previous
              </Link>
            )}
            <span className="text-sm tabular-nums text-white/45">
              Page {data.page} of {data.totalPages}
            </span>
            {page < data.totalPages && (
              <Link
                href={`/movies?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page + 1}`}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium transition-all hover:border-gold/40 hover:text-gold"
              >
                Next <ArrowRightIcon className="h-4 w-4" />
              </Link>
            )}
          </div>
        </>
      )}

      <TmdbAttribution className="mt-12 text-center" />
    </main>
  );
}
