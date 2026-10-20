import type { NoteTone } from "@prisma/client";

/**
 * Note card tints, from the brand pastels (decoration only: a tone never
 * carries meaning, so no word is needed). Light mode uses the solid pastels;
 * dark mode's tokens resolve to the soft fills automatically.
 */
export const NOTE_TONE_OPTIONS: ReadonlyArray<{ value: NoteTone; label: string; card: string; swatch: string }> = [
  { value: "PLAIN", label: "Plain", card: "bg-panel", swatch: "bg-panel" },
  { value: "CITRON", label: "Citron", card: "bg-success-bg", swatch: "bg-success-bg" },
  { value: "SKY", label: "Sky", card: "bg-info-bg", swatch: "bg-info-bg" },
  { value: "YELLOW", label: "Warm yellow", card: "bg-warning-bg", swatch: "bg-warning-bg" },
  { value: "ORANGE", label: "Workshop orange", card: "bg-highlight-soft", swatch: "bg-highlight-soft" },
  { value: "TEAL", label: "Maker teal", card: "bg-accent-soft", swatch: "bg-accent-soft" },
];

export function toneClasses(tone: NoteTone): string {
  return NOTE_TONE_OPTIONS.find((option) => option.value === tone)?.card ?? "bg-panel";
}
