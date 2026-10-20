import { cn } from "@/lib/cn";

/**
 * Patch, the Space Works mascot (an African painted wolf with a wrench), from
 * the design system's compressed files. Patch is the friendly face for empty
 * states, onboarding, loading, success and error pages; the box symbol stays
 * the logo. Rules from the design system:
 * - never recolour, mirror, stretch or add effects; `walk-left` would be the
 *   only way to face left, so this component never flips the art;
 * - dark surfaces use the `dark/` files with the cream sticker border;
 * - with reduced motion the idle frame shows instead of repeating;
 * - Patch is the layout's one bold moment, so use one per screen.
 */
export type PatchPose = "idle" | "walk";

const FILES: Record<PatchPose, { animated: string; still: string; ratio: string }> = {
  idle: { animated: "patch-animated.webp", still: "patch.webp", ratio: "aspect-square" },
  walk: { animated: "patch-walk-animated.webp", still: "patch-walk.webp", ratio: "aspect-[16/11]" },
};

const BASE = "/brand/mascot";

function Art({ pose, dark, animated }: { pose: PatchPose; dark: boolean; animated: boolean }) {
  const folder = dark ? `${BASE}/dark` : BASE;
  const file = FILES[pose];
  const still = `${folder}/${file.still}`;
  return (
    <picture className={cn("block size-full", dark ? "hidden dark:block" : "block dark:hidden")}>
      {animated ? <source srcSet={still} media="(prefers-reduced-motion: reduce)" /> : null}
      {/* Plain <img>: next/image would re-encode the animated WebP. */}
      <img src={animated ? `${folder}/${file.animated}` : still} alt="" className="size-full object-contain" draggable={false} decoding="async" loading="lazy" />
    </picture>
  );
}

export function Patch({ pose = "idle", size = 120, animated = true, className, label }: { pose?: PatchPose; size?: number; animated?: boolean; className?: string; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // Callers keep the brand's clear space (a quarter of the badge height) around this box.
      className={cn("inline-block shrink-0 select-none", FILES[pose].ratio, className)}
      style={{ width: size }}
    >
      <Art pose={pose} dark={false} animated={animated} />
      <Art pose={pose} dark animated={animated} />
    </span>
  );
}
