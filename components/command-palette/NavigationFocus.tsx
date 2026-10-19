"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
let previousPath: string | null = null;
/** Keep keyboard users at the content landmark after client navigation and template remounts. */
export function NavigationFocus() {
  const pathname = usePathname();
  useEffect(() => {
    const moved = previousPath !== null && previousPath !== pathname;
    previousPath = pathname;
    if (moved)
      document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
