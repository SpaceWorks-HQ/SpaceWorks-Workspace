import { Archive, CircleCheck, Info, Moon, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export const MOODS = ["happy", "cheering", "wink", "love", "done", "waiting", "surprised", "thinking", "sleepy", "sad"] as const;
export type Mood = (typeof MOODS)[number];

/** Each mood is a brand icon on a brand fill; ink icons keep contrast on every fill in both modes. */
const MOOD_TILES: Record<Mood, { icon: LucideIcon; fill: string }> = {
  happy: { icon: CircleCheck, fill: "bg-sw-citron" },
  cheering: { icon: CircleCheck, fill: "bg-sw-citron" },
  wink: { icon: Info, fill: "bg-sw-yellow" },
  love: { icon: CircleCheck, fill: "bg-sw-sky" },
  done: { icon: CircleCheck, fill: "bg-sw-citron" },
  waiting: { icon: Archive, fill: "bg-sw-sky" },
  surprised: { icon: TriangleAlert, fill: "bg-sw-yellow" },
  thinking: { icon: Info, fill: "bg-sw-yellow" },
  sleepy: { icon: Moon, fill: "bg-sw-sky" },
  sad: { icon: TriangleAlert, fill: "bg-sw-cream" },
};

/**
 * A decorative mood tile: the Space Works mood tile for
 * empty states, greetings and activity rows. `size` is the tile edge in px.
 * The artwork stays still; colour carries the quiet emphasis.
 */
export function MoodTile({ mood, size = 48, className }: { mood: Mood; size?: number; className?: string }) {
  const { icon: Icon, fill } = MOOD_TILES[mood];
  return (
    <span
      aria-hidden
      className={cn("sw-wiggle-host inline-flex shrink-0 items-center justify-center text-sw-ink", fill, className)}
      style={{ width: size, height: size, borderRadius: Math.max(6, Math.round(size / 4)) }}
    >
      <Icon size={20} strokeWidth={2} />
    </span>
  );
}
