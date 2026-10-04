"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import type { MovieSummary } from "@moviewatch/contracts";
import { StarIcon } from "@/components/icons";

function formatDate(iso: string | null): string {
  if (!iso) return "Date TBA";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function MovieCard({ movie, index = 0 }: { movie: MovieSummary; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.45), ease: "easeOut" }}
    >
      <Link
        href={`/movies/${movie.tmdbId}`}
        className="group block overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-gold/30 hover:shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-white/[0.04]">
          {movie.posterUrl ? (
            <Image
              src={movie.posterUrl}
              alt={`${movie.title} poster`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-white/[0.06] to-transparent p-4 text-center text-sm text-white/40">
              {movie.title}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          {movie.voteAverage > 0 && (
            <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-xs font-bold text-gold backdrop-blur-md">
              <StarIcon className="h-3 w-3" />
              {movie.voteAverage.toFixed(1)}
            </span>
          )}
          <span className="absolute bottom-2.5 right-2.5 translate-y-2 rounded-full bg-gold px-3.5 py-1.5 text-xs font-bold text-black opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            Watch tickets
          </span>
        </div>
        <div className="p-4">
          <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-gold">
            {movie.title}
          </h3>
          <p className="mt-1 text-xs text-white/45">{formatDate(movie.releaseDate)}</p>
        </div>
      </Link>
    </motion.div>
  );
}
