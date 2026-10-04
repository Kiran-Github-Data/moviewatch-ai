"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import type { MovieSummary } from "@moviewatch/contracts";

function formatDate(iso: string | null): string {
  if (!iso) return "Date TBA";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function MovieCard({ movie, index = 0 }: { movie: MovieSummary; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }}
    >
      <Link
        href={`/movies/${movie.tmdbId}`}
        className="group block overflow-hidden rounded-2xl border border-white/10 bg-surface transition-colors hover:border-gold/40"
      >
        <div className="relative aspect-[2/3] w-full bg-white/5">
          {movie.posterUrl ? (
            <Image
              src={movie.posterUrl}
              alt={`${movie.title} poster`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
              {movie.title}
            </div>
          )}
          {movie.voteAverage > 0 && (
            <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-gold">
              ★ {movie.voteAverage.toFixed(1)}
            </span>
          )}
        </div>
        <div className="p-3">
          <h3 className="truncate text-sm font-semibold group-hover:text-gold">{movie.title}</h3>
          <p className="mt-0.5 text-xs text-muted">{formatDate(movie.releaseDate)}</p>
        </div>
      </Link>
    </motion.div>
  );
}
