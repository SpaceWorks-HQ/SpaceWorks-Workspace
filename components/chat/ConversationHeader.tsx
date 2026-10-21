"use client";

import Link from "next/link";
import { ArrowLeft, Info, Search } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Chip } from "@/components/ui/display";
import type { ChannelInfo } from "@/lib/chat/types";
import type { ConversationPanel } from "./useConversationTimeline";

export function ConversationHeader({ info, viewerId, backHref, panel, setPanel }: {
  info: ChannelInfo;
  viewerId: string;
  backHref: string;
  panel: ConversationPanel;
  setPanel: (panel: ConversationPanel) => void;
}) {
  const isDm = info.kind === "DIRECT";
  return (
    <header className="flex min-h-14 items-center gap-1 border-b border-line px-2 sm:px-3">
      <Link href={backHref} aria-label={isDm ? "Back to direct messages" : "Back to channels"} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink md:hidden">
        <ArrowLeft aria-hidden className="size-5" />
      </Link>
      <h1 className="min-w-0 flex-1">
      <button type="button" onClick={() => setPanel({ type: "details" })} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-subtle">
        {isDm ? (
          <span className="flex -space-x-2">
            {info.people.filter((p) => p.id !== viewerId).slice(0, 3).map((p) => (
              <Avatar key={p.id} name={p.name} src={p.image} size="sm" className="ring-2 ring-panel" />
            ))}
          </span>
        ) : info.kind === "PRIVATE" ? (
          <span className="inline-flex items-center justify-center text-xs font-semibold">Private</span>
        ) : (
          <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">#</span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-title text-ink">{info.name}</span>
          {info.topic ? <span className="block truncate text-caption font-normal text-ink-muted">{info.topic}</span> : null}
        </span>
        {info.archived ? <Chip tone="warning" size="sm" className="ml-1">Archived</Chip> : null}
      </button>
      </h1>
      {!isDm ? (
        <button type="button" onClick={() => setPanel({ type: "details" })} className="hidden min-h-11 items-center gap-1.5 rounded-md px-2.5 text-label text-ink-secondary hover:bg-muted hover:text-ink sm:inline-flex">
          <span className="tabular-nums">{info.memberCount}</span>
          <span>{info.memberCount === 1 ? "member" : "members"}</span>
        </button>
      ) : null}
      <Button variant="quiet" className="min-w-11 px-2" title="Pinned messages" onClick={() => setPanel({ type: "pinned" })} aria-pressed={panel?.type === "pinned"}>
        Pinned
      </Button>
      <IconButton label="Search this conversation" onClick={() => setPanel({ type: "search" })} aria-pressed={panel?.type === "search"}>
        <Search />
      </IconButton>
      <IconButton label="Details" onClick={() => setPanel({ type: "details" })} aria-pressed={panel?.type === "details"} className="hidden sm:inline-flex">
        <Info />
      </IconButton>
    </header>
  );
}
