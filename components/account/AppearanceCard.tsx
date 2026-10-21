"use client";

import { SegmentedControl } from "@/components/ui/choice";
import { useAppColorMode } from "@/components/providers";
import type { ColorMode } from "@/lib/colorMode";

export function AppearanceCard() {
  const { mode, setColorModePreference } = useAppColorMode();
  return (
    <SegmentedControl<ColorMode>
      ariaLabel="Colour mode"
      value={mode}
      onValueChange={(value) => setColorModePreference(value)}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}
