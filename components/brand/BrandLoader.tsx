import { cn } from "@/lib/cn";

/** Maker Teal, Workshop Orange and an ink dot (cream in dark mode), hopping left to right in turn. */
const DOTS = [
  { className: "bg-primary", delay: 0 },
  { className: "bg-highlight", delay: 160 },
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

/** Route-level loading state: the brand loader fixed in the centre of the viewport. */
export function BrandPageLoader({ label }: { label?: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
      <BrandLoader size={56} label={label} />
    </div>
  );
}
