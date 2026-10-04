"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SearchBox({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        router.push(q ? `/movies?tab=search&q=${encodeURIComponent(q)}` : "/movies");
      }}
      className="flex w-full max-w-md gap-2"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search movies…"
        aria-label="Search movies"
        className="w-full rounded-xl border border-white/10 bg-surface px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-gold/50"
      />
      <button
        type="submit"
        className="rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
      >
        Search
      </button>
    </form>
  );
}
