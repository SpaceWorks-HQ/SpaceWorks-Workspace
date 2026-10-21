"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { browseChannelsAction, joinChannelAction } from "@/app/actions/chat";
import { canAdministerChannel, canCreateChannel, canJoinPublic } from "@/lib/chat/client";
import { formatRelativeTime } from "@/lib/format/datetime";
import type { BrowseChannel } from "@/lib/chat/types";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/choice";
import { Chip, EmptyState } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { CreateChannelDialog, type TeamOption } from "@/components/chat/ChannelDialogs";
import { useChat } from "@/components/chat/ChatProvider";

/** Every channel the member can find: join public ones, open the rest. */
export function ChannelBrowser({ initial, teams }: { initial: BrowseChannel[]; teams: TeamOption[] }) {
  const { slug, viewer, timeZone } = useChat();
  const router = useRouter();
  const { showToast } = useToast();
  const [channels, setChannels] = useState(initial);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const list = useMemo(
    () => channels.filter((c) => (showArchived || !c.archived) && (!q || c.name.includes(q) || (c.topic ?? "").toLowerCase().includes(q))),
    [channels, q, showArchived],
  );

  const toggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    if (next) {
      startTransition(async () => {
        const result = await browseChannelsAction(slug, { includeArchived: true });
        if (result.ok) setChannels(result.data!);
      });
    }
  };

  const join = async (channel: BrowseChannel) => {
    setJoining(channel.id);
    const result = await joinChannelAction(slug, { channelId: channel.id });
    setJoining(null);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    router.push(result.data!.href);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h1 className="text-h4 text-ink">Browse channels</h1>
          <p className="text-caption text-ink-muted">Find a conversation and join in.</p>
        </div>
        {canCreateChannel(viewer, "PRIVATE") ? (
          <Button variant="primary" startIcon={<Plus />} onClick={() => setCreateOpen(true)}>
            Create a channel
          </Button>
        ) : null}
      </header>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search channels" aria-label="Search channels" />
        </div>
        {canAdministerChannel(viewer) ? (
          <FilterChip selected={showArchived} onClick={toggleArchived} disabled={pending}>
            Show archived
          </FilterChip>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {list.length === 0 ? (
          <EmptyState patch
            title={q ? "No channels match that search." : "No channels yet."}
            action={
              !q && canCreateChannel(viewer, "PRIVATE") ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create a channel
                </Button>
              ) : undefined
            }
          >
            {q ? "Try another word." : "Start one for the next build night."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {list.map((channel) => (
              <li key={channel.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <Link href={channel.href} className="group min-w-0 flex-1 rounded-md">
                  <span className="flex items-center gap-1.5 text-title text-ink group-hover:underline group-hover:underline-offset-4">
                    {channel.kind === "PUBLIC" ? <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">#</span> : null}
                    {channel.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
                    <span className="tabular-nums">{channel.memberCount === 1 ? "1 member" : `${channel.memberCount} members`}</span>
                    {channel.lastMessageAt ? <span suppressHydrationWarning>Active {formatRelativeTime(channel.lastMessageAt, timeZone).toLowerCase()}</span> : null}
                    {channel.topic ? <span className="truncate">{channel.topic}</span> : null}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {channel.isMember ? <Chip tone="success" size="sm">Joined</Chip> : null}
                    {channel.kind === "PRIVATE" ? <Chip tone="neutral" size="sm">Private</Chip> : null}
                    {channel.isDefault ? <Chip tone="accent" size="sm">Default</Chip> : null}
                    {channel.archived ? <Chip tone="warning" size="sm">Archived</Chip> : null}
                    {channel.teamName ? <Chip tone="outline" size="sm">{channel.teamName}</Chip> : null}
                  </span>
                </Link>
                {channel.isMember || channel.archived ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={channel.href}>Open</Link>
                  </Button>
                ) : channel.kind === "PUBLIC" && canJoinPublic(viewer) ? (
                  <Button size="sm" variant="primary" loading={joining === channel.id} onClick={() => void join(channel)}>
                    Join
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={channel.href}>Preview</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} teams={teams} />
    </div>
  );
}
