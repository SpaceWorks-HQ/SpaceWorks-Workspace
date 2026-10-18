import type { LabelTone } from "@prisma/client";

/** Label tones map onto the status-pill tones in components/ui/display.tsx. */
export const LABEL_TONES: ReadonlyArray<{ value: LabelTone; label: string }> = [
  { value: "NEUTRAL", label: "Neutral" },
  { value: "SUCCESS", label: "Citron" },
  { value: "INFO", label: "Sky" },
  { value: "WARNING", label: "Yellow" },
  { value: "DANGER", label: "Red" },
  { value: "ACCENT", label: "Teal" },
  { value: "HIGHLIGHT", label: "Orange" },
];

export function labelChipTone(tone: LabelTone): "neutral" | "success" | "info" | "warning" | "danger" | "accent" | "highlight" {
  return tone.toLowerCase() as ReturnType<typeof labelChipTone>;
}
