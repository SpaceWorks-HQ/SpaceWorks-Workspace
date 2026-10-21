import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";
import { ColorModeToggle } from "@/components/chrome/ColorModeToggle";

/** Plain top bar + centred column for /account and /admin (no workspace sidebar). */
export function SimpleShell({ children, backHref = "/", backLabel = "Back to workspace", nav }: { children: ReactNode; backHref?: string; backLabel?: string; nav?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas">
        <div className="mx-auto flex min-h-[72px] w-full max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={backHref} aria-label="Space Works Workspace home" className="inline-flex rounded-md">
            <SpaceWorksLogo variant="symbol" height={48} label={null} className="sm:hidden" />
            <SpaceWorksLogo variant="lockup-horizontal" height={48} label={null} className="hidden sm:inline-flex" />
          </Link>
          <div className="flex items-center gap-2">
            <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-ink hover:bg-muted">
              <ArrowLeft aria-hidden className="size-4" />
              {backLabel}
            </Link>
            <ColorModeToggle />
          </div>
        </div>
        {nav ? <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6">{nav}</div> : null}
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 focus:outline-none sm:px-6">
        {children}
      </main>
    </div>
  );
}
