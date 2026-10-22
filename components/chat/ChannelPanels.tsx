"use client";

import { useCallback, useEffect, useState } from "react";
import { loadPinnedAction, setPinnedAction } from "@/app/actions/chat";
import { formatDate } from "@/lib/format/datetime";
import type { ChannelInfo, MessageDTO } from "@/lib/chat/types";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/display";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat, useChatEvents } from "@/components/chat/ChatProvider";
import { SearchResults } from "@/components/chat/SearchResults";
import { messageBodyClass } from "@/components/chat/ui";
import { PanelFrame, subtitleFor } from "./ChannelPanelFrame";

export { DetailsPanel } from "./ChannelDetailsPanel";

// ───────────── Pinned ─────────────

export function PinnedPanel({ info, onClose, onJump }: { info: ChannelInfo; onClose: () => void; onJump: (message: MessageDTO) => void }) {
  const { slug, timeZone } = useChat();
  const { showToast } = useToast();
  const [items, setItems] = useState<MessageDTO[] | null>(null);

  const load = useCallback(() => loadPinnedAction(slug, { channelId: info.id }).then((result) => setItems(result.ok ? result.data! : [])), [slug, info.id]);

  useEffect(() => {
    let alive = true;
    loadPinnedAction(slug, { channelId: info.id }).then((result) => {
      if (alive) setItems(result.ok ? result.data! : []);
    });
    return () => {
      alive = false;
    };
  }, [slug, info.id]);

  useChatEvents((event) => {
    if (event.channel === `channel:${info.id}` && (event.type === "message.updated" || event.type === "message.deleted")) void load();
  });

  const unpin = async (message: MessageDTO) => {
    const result = await setPinnedAction(slug, { messageId: message.id, pinned: false });
    if (!result.ok) showToast(result.error, "error");
    else void load();
  };

  return (
    <PanelFrame title="Pinned" subtitle={subtitleFor(info)} onClose={onClose}>
      {items === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing pinned yet.">Pin a message to keep it handy for everyone here.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((message) => (
            <li key={message.id} className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center gap-2">
                <Avatar name={message.author?.name ?? "Space Works"} src={message.author?.image} size="xs" />
                <span className="min-w-0 flex-1 truncate text-label text-ink">{message.author?.name ?? "Space Works"}</span>
                <span className="text-caption text-ink-muted tabular-nums">{formatDate(message.createdAt, timeZone)}</span>
              </div>
              <div className={`${messageBodyClass} line-clamp-6`} dangerouslySetInnerHTML={{ __html: message.html }} />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => onJump(message)}>
                  Jump to message
                </Button>
                {message.canPin ? (
                  <Button size="sm" variant="quiet" onClick={() => void unpin(message)}>
                    Unpin
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}

// ───────────── Search ─────────────

export function SearchPanel({ info, onClose }: { info: ChannelInfo; onClose: () => void }) {
  return (
    <PanelFrame title="Search" subtitle={subtitleFor(info)} onClose={onClose}>
      <SearchResults channel={{ id: info.id, label: info.kind === "DIRECT" ? "This conversation" : `#${info.name}` }} autoFocus />
    </PanelFrame>
  );
}
