"use client";

import { SegmentedControl } from "@/components/ui/choice";
import { useAppColorMode, type ColorModePreference } from "@/components/providers";

export function AppearanceCard() {
  const { preference, setColorModePreference } = useAppColorMode();
  return (
    <SegmentedControl<ColorModePreference>
      ariaLabel="Colour mode"
      value={preference}
      onValueChange={(value) => setColorModePreference(value)}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "Match device" },
      ]}
    />
  );
}
