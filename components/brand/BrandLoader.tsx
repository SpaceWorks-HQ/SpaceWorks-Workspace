import { cn } from "@/lib/cn";
import { Patch } from "./Patch";

/** Teal, soft accent and an ink dot (cream in dark mode), hopping left to right in turn. */
const DOTS = [
  { className: "bg-primary", delay: 0 },
  { className: "bg-accent-soft", delay: 160 },
  { className: "bg-ink", delay: 320 },
] as const;

/**
 * Loading indicator: three brand dots that hop one after the other. `size`
 * is the overall width in px. Still under reduced motion. Announces `label`
 * politely to assistive technology.
 */
export function BrandLoader({ size = 48, label = "Loading", className }: { size?: number; label?: string; className?: string }) {
  const dot = size / 4.2;
  return (
    <span role="status" className={cn("inline-flex flex-col items-center", className)}>
      <span aria-hidden="true" className="flex items-end" style={{ gap: dot * 0.6, height: dot * 1.8 }}>
        {DOTS.map((item, index) => (
          <span
            key={index}
            className={cn("yy-dot-loader-jump block shrink-0 rounded-full", item.className)}
            style={{ width: dot, height: dot, animationDelay: `${item.delay}ms` }}
          />
        ))}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Route-level loading state. Patch is the single bold moment. */
export function BrandPageLoader({ label }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-3">
      <Patch pose="walk" size={128} />
      <p className="text-body-ui text-ink-muted">{label ?? "Loading page"}</p>
    </div>
  );
}
