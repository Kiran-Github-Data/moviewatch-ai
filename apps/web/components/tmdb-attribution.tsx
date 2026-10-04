/**
 * TMDB attribution — required by the TMDB API terms of service.
 * Render on every screen that shows TMDB-sourced data.
 */
export function TmdbAttribution({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      This product uses the{" "}
      <a
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-white/30 underline-offset-2 hover:text-white"
      >
        TMDB API
      </a>{" "}
      but is not endorsed or certified by TMDB.
    </p>
  );
}
