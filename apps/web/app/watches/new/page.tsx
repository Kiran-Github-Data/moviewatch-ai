import { Suspense } from "react";
import { WatchWizard } from "@/components/watch-wizard";

export default function NewWatchPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-6 py-10 text-muted">Loading…</main>}>
      <WatchWizard />
    </Suspense>
  );
}
