import * as React from "react";
import { cn } from "./utils";

type Variant = "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--mw-gold)] text-black font-semibold hover:brightness-110 focus-visible:ring-[var(--mw-gold)]",
  ghost:
    "bg-transparent text-[var(--mw-text)] border border-white/15 hover:bg-white/5",
  danger: "bg-[var(--mw-red)]/15 text-[var(--mw-red)] border border-[var(--mw-red)]/30 hover:bg-[var(--mw-red)]/25",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const buttonVariants = (variant: Variant = "primary", size: Size = "md") =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-full transition-all",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
  );

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants(variant, size), className)} {...props} />
  ),
);
Button.displayName = "Button";
