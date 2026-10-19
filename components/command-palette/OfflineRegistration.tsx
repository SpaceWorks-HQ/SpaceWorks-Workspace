"use client";
import { useEffect } from "react";
export function OfflineRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sww-sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
  }, []);
  return null;
}
