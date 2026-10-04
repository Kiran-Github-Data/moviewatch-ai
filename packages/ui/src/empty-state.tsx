import { cn } from "./utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15",
        "bg-[var(--mw-surface)] px-8 py-16 text-center",
        className,
      )}
    >
      <div className="mb-4 text-4xl" aria-hidden>
        🎬
      </div>
      <h3 className="text-lg font-semibold text-[var(--mw-text)]">{title}</h3>
      {description ? <p className="mt-2 max-w-sm text-sm text-[var(--mw-muted)]">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
