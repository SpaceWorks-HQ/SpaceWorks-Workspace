import type { ReactNode } from "react";
import Link from "next/link";
import { Patch } from "@/components/brand/Patch";
import { SpaceWorksLogo, SpaceWorksWorkspaceLogo } from "@/components/brand/SpaceWorksLogo";

/**
 * Split layout for sign-in, setup, invitation and password pages: the form on
 * the left, a calm brand panel on the right (desktop only). The Unbounded
 * accent phrase appears once, here, never in app chrome.
 */
export function AuthFrame({ title, description, children, accent = "Make things\ntogether." }: { title: ReactNode; description?: ReactNode; children: ReactNode; accent?: string }) {
  return (
    <div className="grid min-h-dvh bg-canvas md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-4 py-5 sm:px-8 sm:py-6">
        <header>
          <Link href="/" aria-label="Space Works Workspace home" className="inline-flex rounded-md">
            <SpaceWorksWorkspaceLogo height={32} label={null} />
          </Link>
        </header>
        <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center py-10 focus:outline-none">
          <div className="flex w-full max-w-[420px] flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-display-l text-ink">{title}</h1>
              {description ? <p className="text-body-ui text-ink-secondary">{description}</p> : null}
            </div>
            {children}
          </div>
        </main>
      </div>
      <aside aria-hidden className="relative hidden overflow-hidden p-4 md:block">
        <div className="relative flex h-full flex-col justify-between gap-10 overflow-hidden rounded-[16px] bg-surface p-12">
          <SpaceWorksLogo variant="lockup-stacked" height={72} className="self-start" />
          <div className="relative flex flex-col gap-3 py-6">
            <span className="absolute -right-16 -top-10 size-44 rounded-full bg-sw-citron" />
            <span className="absolute -bottom-2 right-20 size-20 rounded-[16px] bg-sw-sky" />
            <span className="relative max-w-[320px] -rotate-2 rounded-xl border border-line bg-panel p-4 text-label text-ink">#build-night · Soldering the LED wall tonight</span>
            <span className="relative ml-12 max-w-[320px] rotate-1 rounded-xl border border-line bg-panel p-4 text-label text-ink">BOT-12 · Motor driver board moved to Review</span>
            <span className="relative ml-4 inline-flex items-center gap-2 self-start rounded-full bg-sw-citron px-4 py-2 text-label text-sw-ink">Shoutout to Meera for the 3D prints</span>
          </div>
          <p className="relative flex items-end justify-between gap-6">
            <span className="whitespace-pre-line font-accent text-[34px] font-medium leading-[1.1] text-ink">{accent}</span>
            <Patch size={128} className="-mb-2 shrink-0" />
          </p>
        </div>
      </aside>
    </div>
  );
}
