const IMAGE_BASE = "https://image.tmdb.org/t/p";

export type PosterSize = "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original";
export type BackdropSize = "w300" | "w780" | "w1280" | "original";
export type ProfileSize = "w45" | "w185" | "h632" | "original";

/** Full image URL for a TMDB path, or null when the path is missing. */
export function imageUrl(
  path: string | null | undefined,
  size: PosterSize | BackdropSize | ProfileSize = "w500",
): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

export const posterUrl = (path: string | null | undefined, size: PosterSize = "w500") =>
  imageUrl(path, size);
export const backdropUrl = (path: string | null | undefined, size: BackdropSize = "w1280") =>
  imageUrl(path, size);
