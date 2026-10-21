"use client";

import { IconButton } from "@/components/ui/button";
import type { ChannelInfo } from "@/lib/chat/types";

export function PanelFrame({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 items-center justify-between gap-2 border-b border-line pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="text-title text-ink">{title}</h2>
          {subtitle ? <p className="truncate text-caption text-ink-muted">{subtitle}</p> : null}
        </div>
        <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">{children}</div>
    </section>
  );
}

export const subtitleFor = (info: ChannelInfo) => (info.kind === "DIRECT" ? info.name : `#${info.name}`);
