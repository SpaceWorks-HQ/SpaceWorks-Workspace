"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { loadSidebarAction } from "@/app/actions/chat";
import { cn } from "@/lib/cn";
import { canCreateChannel, canStartDirectMessage, formatBadge, sidebarState } from "@/lib/chat/client";
import type { SidebarData, SidebarItem } from "@/lib/chat/types";
import { Avatar } from "@/components/ui/display";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { CreateChannelDialog, NewMessageDialog, type TeamOption } from "@/components/chat/ChannelDialogs";
import { useChat, useChatEvents } from "@/components/chat/ChatProvider";

const REFRESH_TYPES = new Set(["message.created", "message.deleted", "channel.updated", "channel.members", "chat.read", "chat.membership", "chat.reconnected", "chat.visible"]);

/**
 * Channel and DM list with unread state. Refreshes itself (debounced) when
 * realtime events touch a conversation in the list, and treats the open
 * conversation as read.
 */
export function ChatSidebar({ initial, teams }: { initial: SidebarData; teams: TeamOption[] }) {
  const { slug, viewer } = useChat();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [createOpen, setCreateOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const known = useRef(new Set<string>());

  useEffect(() => {
    known.current = new Set([...data.channels, ...data.dms].map((item) => item.id));
  }, [data]);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const result = await loadSidebarAction(slug);
      if (result.ok && result.data) setData(result.data);
    }, 500);
  }, [slug]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // A fresh server render (navigation, router.refresh) brings newer data.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setData(initial);
  }

  useChatEvents((event) => {
    if (!REFRESH_TYPES.has(event.type)) return;
    const channelId = typeof event.data?.channelId === "string" ? event.data.channelId : null;
    // New DMs and channels arrive via message events for conversations not in the list yet.
    if (event.type.startsWith("message.") && channelId && !known.current.has(channelId) && event.audience === undefined) return;
    refresh();
  });

  const isActive = (item: SidebarItem) => pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Link
          href={`/w/${slug}/chat/search`}
          className="flex min-h-10 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-3 text-body-ui text-ink-muted transition-colors duration-[120ms] hover:border-line-strong hover:text-ink"
        >
          <Search aria-hidden className="size-4" />
          Search messages
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <SectionHeading
          title="Channels"
          action={
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Add a channel" size="sm">
                  <Plus />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                {canCreateChannel(viewer, "PRIVATE") ? <MenuItem onSelect={() => setCreateOpen(true)}>Create a channel</MenuItem> : null}
                <MenuItem asChild>
                  <Link href={`/w/${slug}/chat/browse`}>Browse channels</Link>
                </MenuItem>
              </MenuContent>
            </Menu>
          }
        />
        {data.channels.length === 0 ? (
          <p className="px-3 py-2 text-caption text-ink-muted">
            No channels yet. <Link className="text-accent-text underline underline-offset-2" href={`/w/${slug}/chat/browse`}>Browse channels</Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {data.channels.map((item) => (
              <li key={item.id}>
                <Row item={item} active={isActive(item)} />
              </li>
            ))}
          </ul>
        )}

        {canStartDirectMessage(viewer) ? (
          <>
            <SectionHeading
              title="Direct messages"
              action={
                <IconButton label="New message" size="sm" onClick={() => setDmOpen(true)}>
                  <Plus />
                </IconButton>
              }
            />
            {data.dms.length === 0 ? (
              <p className="px-3 py-2 text-caption text-ink-muted">No direct messages yet.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {data.dms.map((item) => (
                  <li key={item.id}>
                    <Row item={item} active={isActive(item)} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
      <CreateChannelDialog open={createOpen} onOpenChange={setCreateOpen} teams={teams} />
      {canStartDirectMessage(viewer) ? <NewMessageDialog open={dmOpen} onOpenChange={setDmOpen} /> : null}
    </nav>
  );
}

function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-between pl-3 pr-1">
      <h2 className="text-overline text-ink-muted">{title}</h2>
      {action}
    </div>
  );
}

function Row({ item, active }: { item: SidebarItem; active: boolean }) {
  const state = sidebarState({ kind: item.kind, unread: active ? 0 : item.unread, mentions: active ? 0 : item.mentions, notify: item.notify });
  const label = [
    item.kind === "DIRECT" ? `Direct message with ${item.name}` : `${item.kind === "PRIVATE" ? "Private channel" : "Channel"} ${item.name}`,
    state.badge ? (item.kind === "DIRECT" ? `${state.badge} unread` : `${state.badge} mentions`) : state.bold ? "unread messages" : null,
    state.muted ? "muted" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-md px-3 text-sm transition-colors duration-[120ms]",
        active ? "bg-accent-soft font-semibold text-accent-text" : "text-ink-secondary hover:bg-subtle hover:text-ink",
        !active && state.bold && "font-semibold text-ink",
        !active && state.muted && "text-ink-muted",
      )}
    >
      {item.kind === "DIRECT" ? (
        <Avatar name={item.people?.[0]?.name ?? item.name} src={item.people?.[0]?.image} size="xs" />
      ) : item.kind === "PRIVATE" ? (
        <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">Private</span>
      ) : (
        <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">#</span>
      )}
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {state.muted ? <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">Muted</span> : null}
      {state.badge ? (
        <span aria-hidden className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 text-xs font-semibold leading-5 text-accent-text tabular-nums">
          {formatBadge(state.badge)}
        </span>
      ) : null}
    </Link>
  );
}
