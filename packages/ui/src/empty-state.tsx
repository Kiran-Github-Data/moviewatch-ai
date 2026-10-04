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
        "flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/15",
        "bg-white/[0.02] px-8 py-16 text-center backdrop-blur-sm",
        className,
      )}
    >
      <span
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--mw-gold-soft)] text-[var(--mw-gold)]"
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7"
        >
          <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
          <path d="M13 5v2" />
          <path d="M13 17v2" />
          <path d="M13 11v2" />
        </svg>
      </span>
      <h3 className="text-lg font-semibold text-[var(--mw-text)]">{title}</h3>
      {description ? <p className="mt-2 max-w-sm text-sm text-[var(--mw-muted)]">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
