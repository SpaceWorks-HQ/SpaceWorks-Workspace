"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, Hash, Info, Lock, Pin, Search, Users } from "lucide-react";
import {
  editMessageAction,
  joinChannelAction,
  leaveChannelAction,
  loadMessagesAction,
  loadMessagesByIdsAction,
  markReadAction,
  openDirectMessageAction,
  postMessageAction,
  updateChannelAction,
} from "@/app/actions/chat";
import { cn } from "@/lib/cn";
import { extractUserMentions, firstUnreadId } from "@/lib/chat/client";
import type { ChannelInfo, MessageDTO, MessagePage } from "@/lib/chat/types";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Callout, Chip } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat, useChatEvents } from "@/components/chat/ChatProvider";
import { Composer, type ComposerSubmit } from "@/components/chat/Composer";
import { MessageItem } from "@/components/chat/MessageItem";
import { DetailsPanel, PinnedPanel, SearchPanel } from "@/components/chat/ChannelPanels";
import { ThreadPanel } from "@/components/chat/ThreadPanel";
import { useMessageActions } from "@/components/chat/useMessageActions";
import { continuesPrevious, dayKey, dayLabel, mergeMessages } from "@/components/chat/ui";

type Panel = { type: "thread"; parentId: string; highlightId?: string | null } | { type: "pinned" } | { type: "details" } | { type: "search" } | null;

type PendingSend = { key: string; text: string };

/**
 * One conversation (channel or DM): header, timeline with infinite scroll
 * both ways, "New messages" divider, composer, and a side panel for threads,
 * pinned messages, details and search. Realtime events refetch by id; a
 * reconnect or returning to the tab catches up with the latest page.
 */
export function Conversation({ info, initial, initialThreadId, highlightId }: { info: ChannelInfo; initial: MessagePage; initialThreadId: string | null; highlightId: string | null }) {
  const { slug, timeZone, viewer } = useChat();
  const router = useRouter();
  const { showToast } = useToast();
  const [messages, setMessages] = useState(initial.messages);
  const [hasOlder, setHasOlder] = useState(initial.hasOlder);
  const [hasNewer, setHasNewer] = useState(initial.hasNewer);
  const [loading, setLoading] = useState<"older" | "newer" | "latest" | null>(null);
  const [divider] = useState(() => firstUnreadId(initial.messages.map((m) => ({ id: m.id, createdAt: m.createdAt, authorId: m.author?.id ?? null })), info.lastReadAt, viewer.id));
  const [panel, setPanel] = useState<Panel>(initialThreadId ? { type: "thread", parentId: initialThreadId, highlightId } : null);
  const [highlight, setHighlight] = useState<string | null>(initialThreadId ? null : highlightId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [atBottom, setAtBottom] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const stick = useRef(!highlightId && !divider);
  const prependFrom = useRef<number | null>(null);
  const pendingCount = useRef(0);
  const hasNewerRef = useRef(hasNewer);
  const loadedIds = useRef(new Set(messages.map((m) => m.id)));
  const queue = useRef<{ ids: Set<string>; created: Set<string>; timer: ReturnType<typeof setTimeout> | null }>({ ids: new Set(), created: new Set(), timer: null });
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hasNewerRef.current = hasNewer;
    loadedIds.current = new Set(messages.map((m) => m.id));
  }, [hasNewer, messages]);

  // ── Scrolling ──
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (highlightId && !initialThreadId) document.getElementById(`message-${highlightId}`)?.scrollIntoView({ block: "center" });
    else if (divider) document.getElementById(`divider-${divider}`)?.scrollIntoView({ block: "start" });
    else el.scrollTop = el.scrollHeight;
    // Only on first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop = el.scrollHeight - prependFrom.current;
      prependFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(timer);
  }, [highlight]);

  // ── Read marker ──
  const scheduleRead = useCallback(() => {
    if (!info.isMember) return;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      if (document.visibilityState !== "visible" || hasNewerRef.current || !stick.current) return;
      void markReadAction(slug, { channelId: info.id });
    }, 800);
  }, [info.isMember, info.id, slug]);

  useEffect(() => {
    scheduleRead();
    return () => {
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [scheduleRead]);

  // ── Paging ──
  const loadOlder = useCallback(async () => {
    if (loading || !hasOlder || messages.length === 0) return;
    setLoading("older");
    const result = await loadMessagesAction(slug, { channelId: info.id, before: messages[0]!.cursor });
    setLoading(null);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    const el = scroller.current;
    if (el) prependFrom.current = el.scrollHeight - el.scrollTop;
    setMessages((current) => mergeMessages(current, result.data!.messages));
    setHasOlder(result.data!.hasOlder);
  }, [loading, hasOlder, messages, slug, info.id, showToast]);

  const loadNewer = async () => {
    if (loading || messages.length === 0) return;
    setLoading("newer");
    const result = await loadMessagesAction(slug, { channelId: info.id, after: messages[messages.length - 1]!.cursor });
    setLoading(null);
    if (!result.ok) return showToast(result.error, "error");
    setMessages((current) => mergeMessages(current, result.data!.messages));
    setHasNewer(result.data!.hasNewer);
  };

  const jumpToLatest = useCallback(async () => {
    setLoading("latest");
    const result = await loadMessagesAction(slug, { channelId: info.id });
    setLoading(null);
    if (!result.ok) return;
    stick.current = true;
    setMessages(result.data!.messages);
    setHasOlder(result.data!.hasOlder);
    setHasNewer(false);
    scheduleRead();
  }, [slug, info.id, scheduleRead]);

  useEffect(() => {
    const target = topSentinel.current;
    const root = scroller.current;
    if (!target || !root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
    }, { root, rootMargin: "400px 0px 0px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadOlder]);

  // ── Realtime ──
  const flush = useCallback(async () => {
    const q = queue.current;
    q.timer = null;
    const ids = [...q.ids];
    const created = new Set(q.created);
    q.ids.clear();
    q.created.clear();
    if (ids.length === 0) return;
    const result = await loadMessagesByIdsAction(slug, { channelId: info.id, ids });
    if (!result.ok) return;
    const fresh = result.data!.filter((m) => !m.parentId);
    const removed = new Set(fresh.filter((m) => m.deleted && m.replyCount === 0).map((m) => m.id));
    const keep = fresh.filter((m) => !removed.has(m.id) && (loadedIds.current.has(m.id) || created.has(m.id)));
    const gone = ids.filter((id) => !fresh.some((m) => m.id === id));
    setMessages((current) => mergeMessages(current.filter((m) => !removed.has(m.id) && !gone.includes(m.id)), keep));
    if (keep.some((m) => created.has(m.id))) scheduleRead();
  }, [slug, info.id, scheduleRead]);

  const enqueue = useCallback(
    (id: string, isNew = false) => {
      const q = queue.current;
      q.ids.add(id);
      if (isNew) q.created.add(id);
      if (!q.timer) q.timer = setTimeout(() => void flush(), 150);
    },
    [flush],
  );

  const catchUp = useCallback(async () => {
    if (hasNewerRef.current) return;
    const result = await loadMessagesAction(slug, { channelId: info.id });
    if (!result.ok) return;
    const latest = result.data!.messages;
    setMessages((current) => {
      const overlaps = latest.length === 0 || current.length === 0 || latest.some((m) => current.some((c) => c.id === m.id)) || !result.data!.hasOlder;
      if (!overlaps) {
        setHasOlder(true);
        return latest;
      }
      return mergeMessages(current, latest);
    });
    scheduleRead();
  }, [slug, info.id, scheduleRead]);

  useChatEvents((event) => {
    if (event.type === "chat.reconnected" || event.type === "chat.visible") {
      void catchUp();
      return;
    }
    if (event.channel !== `channel:${info.id}`) return;
    const data = event.data ?? {};
    const messageId = typeof data.messageId === "string" ? data.messageId : null;
    const parentId = typeof data.parentId === "string" ? data.parentId : null;
    switch (event.type) {
      case "message.created":
        if (parentId) enqueue(parentId);
        else if (messageId && !hasNewerRef.current && !(event.actorId === viewer.id && pendingCount.current > 0)) enqueue(messageId, true);
        if (typeof event.actorId === "string") {
          const actor = event.actorId;
          setTyping((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== actor)));
        }
        break;
      case "message.updated":
      case "message.deleted":
        if (parentId) enqueue(parentId);
        else if (messageId && loadedIds.current.has(messageId)) enqueue(messageId);
        break;
      case "typing":
        if (typeof data.userId === "string" && data.userId !== viewer.id && !data.parentId) {
          setTyping((current) => ({ ...current, [data.userId as string]: { name: String(data.name ?? "Someone"), until: Date.now() + 6000 } }));
        }
        break;
      case "channel.updated":
      case "channel.members":
        router.refresh();
        break;
    }
  });

  useEffect(() => {
    const ids = Object.keys(typing);
    if (ids.length === 0) return;
    const next = Math.min(...ids.map((id) => typing[id]!.until));
    const timer = setTimeout(() => {
      const now = Date.now();
      setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, t]) => t.until > now)));
    }, Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [typing]);

  // ── Actions ──
  const replace = useCallback((message: MessageDTO) => {
    if (message.parentId) return;
    setMessages((current) => mergeMessages(current, [message]));
  }, []);
  const removeLocal = useCallback((message: MessageDTO) => {
    if (message.parentId) return;
    if (message.replyCount > 0) enqueue(message.id);
    else setMessages((current) => current.filter((m) => m.id !== message.id));
  }, [enqueue]);
  const openThread = useCallback((message: MessageDTO) => {
    setPanel({ type: "thread", parentId: message.id });
    window.history.replaceState(null, "", `${info.href}?thread=${message.id}`);
  }, [info.href]);
  const { actions, confirmDelete, setConfirmDelete, deleting, confirm } = useMessageActions({
    href: info.href,
    onChanged: replace,
    onDeleted: removeLocal,
    onEdit: (message) => setEditingId(message.id),
    onReply: openThread,
  });

  const closePanel = () => {
    setPanel(null);
    window.history.replaceState(null, "", info.href);
  };

  const runCommand = async (raw: string, body: string): Promise<boolean | null> => {
    const [command, ...rest] = raw.trim().split(/\s+/);
    const argument = raw.trim().slice(command!.length).trim();
    switch (command) {
      case "/topic": {
        const result = await updateChannelAction(slug, { channelId: info.id, topic: argument });
        if (!result.ok) showToast(result.error, "error");
        else {
          showToast("Topic updated.", "success");
          router.refresh();
        }
        return result.ok;
      }
      case "/leave": {
        const result = await leaveChannelAction(slug, { channelId: info.id });
        if (!result.ok) showToast(result.error, "error");
        else router.push(`/w/${slug}/chat`);
        return result.ok;
      }
      case "/dm":
      case "/msg": {
        const ids = extractUserMentions(body);
        if (ids.length === 0) {
          showToast("Pick someone with @ after /dm, for example /dm @Meera.", "info");
          return false;
        }
        const result = await openDirectMessageAction(slug, { userIds: ids });
        if (!result.ok) showToast(result.error, "error");
        else router.push(result.data!.href);
        return result.ok;
      }
      default:
        void rest;
        return null;
    }
  };

  const send = async ({ body, attachmentIds, raw }: ComposerSubmit): Promise<boolean> => {
    if (raw.trim().startsWith("/") && attachmentIds.length === 0) {
      const handled = await runCommand(raw, body);
      if (handled !== null) return handled;
      showToast("That command isn't available. Try /topic, /leave or /dm @name.", "info");
      return false;
    }
    const key = `${Date.now()}-${Math.random()}`;
    pendingCount.current += 1;
    stick.current = true;
    setPending((current) => [...current, { key, text: raw || "Sharing a file…" }]);
    const result = await postMessageAction(slug, { channelId: info.id, body, parentId: null, attachmentIds });
    pendingCount.current -= 1;
    setPending((current) => current.filter((p) => p.key !== key));
    if (!result.ok) {
      showToast(result.error, "error");
      return false;
    }
    if (hasNewerRef.current) await jumpToLatest();
    else setMessages((current) => mergeMessages(current, [result.data!.message]));
    return true;
  };

  const saveEdit = (message: MessageDTO) => async ({ body }: ComposerSubmit) => {
    const result = await editMessageAction(slug, { messageId: message.id, body });
    if (!result.ok) {
      showToast(result.error, "error");
      return false;
    }
    replace(result.data!.message);
    setEditingId(null);
    return true;
  };

  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.canEdit);
    if (mine) setEditingId(mine.id);
  };

  const join = async () => {
    const result = await joinChannelAction(slug, { channelId: info.id });
    if (!result.ok) showToast(result.error, "error");
    else router.refresh();
  };

  const typingNames = Object.values(typing).map((t) => t.name);
  const isDm = info.kind === "DIRECT";
  const backHref = isDm ? `/w/${slug}/dm` : `/w/${slug}/chat`;
  const panelOpen = panel !== null;

  return (
    <div className="relative flex min-h-0 flex-1">
      <section aria-label={isDm ? `Conversation with ${info.name}` : `#${info.name}`} className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", panelOpen && "max-lg:hidden")}>
        <header className="flex min-h-14 items-center gap-1 border-b border-line px-2 sm:px-3">
          <Link href={backHref} aria-label={isDm ? "Back to direct messages" : "Back to channels"} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink md:hidden">
            <ArrowLeft aria-hidden className="size-5" />
          </Link>
          <h1 className="min-w-0 flex-1">
          <button type="button" onClick={() => setPanel({ type: "details" })} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-subtle">
            {isDm ? (
              <span className="flex -space-x-2">
                {info.people.filter((p) => p.id !== viewer.id).slice(0, 3).map((p) => (
                  <Avatar key={p.id} name={p.name} src={p.image} size="sm" className="ring-2 ring-panel" />
                ))}
              </span>
            ) : info.kind === "PRIVATE" ? (
              <Lock aria-hidden className="size-[18px] shrink-0 text-ink-secondary" />
            ) : (
              <Hash aria-hidden className="size-[18px] shrink-0 text-ink-secondary" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-title text-ink">{info.name}</span>
              {info.topic ? <span className="block truncate text-caption font-normal text-ink-muted">{info.topic}</span> : null}
            </span>
            {info.archived ? <Chip tone="warning" size="sm" className="ml-1">Archived</Chip> : null}
          </button>
          </h1>
          {!isDm ? (
            <button type="button" onClick={() => setPanel({ type: "details" })} aria-label={`${info.memberCount} members`} className="hidden min-h-11 items-center gap-1.5 rounded-md px-2.5 text-label text-ink-secondary hover:bg-muted hover:text-ink sm:inline-flex">
              <Users aria-hidden className="size-[18px]" />
              <span className="tabular-nums">{info.memberCount}</span>
            </button>
          ) : null}
          <IconButton label="Pinned messages" onClick={() => setPanel({ type: "pinned" })} aria-pressed={panel?.type === "pinned"}>
            <Pin />
          </IconButton>
          <IconButton label="Search this conversation" onClick={() => setPanel({ type: "search" })} aria-pressed={panel?.type === "search"}>
            <Search />
          </IconButton>
          <IconButton label="Details" onClick={() => setPanel({ type: "details" })} aria-pressed={panel?.type === "details"} className="hidden sm:inline-flex">
            <Info />
          </IconButton>
        </header>

        <div
          ref={scroller}
          className="relative min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            const el = event.currentTarget;
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            stick.current = bottom && !hasNewer;
            if (bottom !== atBottom) setAtBottom(bottom);
            if (bottom) scheduleRead();
          }}
        >
          <div ref={topSentinel} aria-hidden className="h-px" />
          {hasOlder ? (
            <div className="flex justify-center py-3">
              {loading === "older" ? <Spinner className="size-5" label="Loading older messages" /> : (
                <Button size="sm" variant="quiet" onClick={() => void loadOlder()}>
                  Load older messages
                </Button>
              )}
            </div>
          ) : (
            <Intro info={info} />
          )}

          <ol className="pb-3" aria-label="Messages">
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || dayKey(previous.createdAt, timeZone) !== dayKey(message.createdAt, timeZone);
              return (
                <Fragment key={message.id}>
                  {newDay ? (
                    <li role="separator" className="flex items-center gap-3 px-4 pb-1 pt-4">
                      <span className="h-px flex-1 bg-line" />
                      <span className="text-caption font-semibold text-ink-secondary" suppressHydrationWarning>
                        {dayLabel(message.createdAt, timeZone)}
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </li>
                  ) : null}
                  {message.id === divider ? (
                    <li id={`divider-${message.id}`} role="separator" aria-label="New messages" className="flex scroll-mt-4 items-center gap-3 px-4 py-1">
                      <span className="h-px flex-1 bg-highlight" />
                      <Chip tone="highlight" size="sm">New messages</Chip>
                    </li>
                  ) : null}
                  <li>
                    <MessageItem
                      message={message}
                      compact={!newDay && message.id !== divider && continuesPrevious(previous, message, timeZone)}
                      highlighted={message.id === highlight}
                      canReact={info.can.post}
                      timeZone={timeZone}
                      actions={actions}
                      editor={
                        editingId === message.id && message.source ? (
                          <Composer
                            mode="edit"
                            channelId={info.id}
                            placeholder="Edit message"
                            allowBroadcast={info.can.broadcast}
                            allowUpload={false}
                            initialText={message.source.text}
                            initialMentions={message.source.mentions}
                            autoFocus
                            onSubmit={saveEdit(message)}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : undefined
                      }
                    />
                  </li>
                </Fragment>
              );
            })}
            {pending.map((item) => (
              <li key={item.key} className="flex gap-3 px-4 py-1 text-body-ui text-ink-muted" aria-live="polite">
                <span className="w-9 shrink-0" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.text}</span>
                <span className="shrink-0 text-caption">Sending…</span>
              </li>
            ))}
          </ol>

          {hasNewer ? (
            <div className="flex justify-center pb-4">
              <Button size="sm" variant="secondary" loading={loading === "newer"} onClick={() => void loadNewer()}>
                Load newer messages
              </Button>
            </div>
          ) : null}
        </div>

        {(hasNewer || !atBottom) && messages.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center">
            <Button
              size="sm"
              variant="secondary"
              className="pointer-events-auto shadow-float"
              startIcon={<ArrowDown />}
              loading={loading === "latest"}
              onClick={() => {
                if (hasNewer) void jumpToLatest();
                else {
                  stick.current = true;
                  scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
                }
              }}
            >
              Jump to latest
            </Button>
          </div>
        ) : null}

        <footer className="border-t border-line p-3">
          {info.archived ? (
            <Callout tone="info" title="This channel is archived.">
              You can read it, but nobody can post.
            </Callout>
          ) : info.can.post ? (
            <Composer
              channelId={info.id}
              placeholder={isDm ? `Message ${info.name}` : `Message #${info.name}`}
              allowBroadcast={info.can.broadcast}
              allowUpload={info.can.upload}
              onSubmit={send}
              onEditLast={editLast}
            />
          ) : info.can.join ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-body-ui text-ink-secondary">You&apos;re reading #{info.name}. Join to post and get notified.</p>
              <Button variant="primary" onClick={() => void join()}>
                Join channel
              </Button>
            </div>
          ) : (
            <p className="text-body-ui text-ink-muted">You can read this conversation but not post in it.</p>
          )}
          <p aria-live="polite" className="min-h-5 pt-1 text-caption text-ink-muted">
            {typingNames.length === 1 ? `${typingNames[0]} is typing…` : typingNames.length > 1 ? "Several people are typing…" : ""}
          </p>
        </footer>
      </section>

      {panel ? (
        <aside className="absolute inset-0 z-20 flex flex-col bg-panel lg:static lg:w-[380px] lg:shrink-0 lg:border-l lg:border-line">
          {panel.type === "thread" ? (
            <ThreadPanel key={panel.parentId} info={info} parentId={panel.parentId} highlightId={panel.highlightId} onClose={closePanel} onRootChanged={replace} />
          ) : panel.type === "pinned" ? (
            <PinnedPanel
              info={info}
              onClose={closePanel}
              onJump={(message) => {
                if (loadedIds.current.has(message.id)) {
                  closePanel();
                  setHighlight(message.id);
                  stick.current = false;
                  requestAnimationFrame(() => document.getElementById(`message-${message.id}`)?.scrollIntoView({ block: "center" }));
                } else router.push(`${info.href}?m=${message.id}`);
              }}
            />
          ) : panel.type === "search" ? (
            <SearchPanel info={info} onClose={closePanel} />
          ) : (
            <DetailsPanel info={info} onClose={closePanel} />
          )}
        </aside>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this message?"
        message={confirmDelete && confirmDelete.replyCount > 0 ? "Its replies stay in the thread. This can't be undone." : "It's removed for everyone. This can't be undone."}
        confirmLabel="Delete message"
        loading={deleting}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function Intro({ info }: { info: ChannelInfo }) {
  if (info.kind === "DIRECT") {
    return (
      <div className="px-4 pb-2 pt-8">
        <p className="text-h4 text-ink">{info.name}</p>
        <p className="mt-1 max-w-xl text-body-ui text-ink-secondary">This is the start of your conversation. Only the people here can see it.</p>
      </div>
    );
  }
  return (
    <div className="px-4 pb-2 pt-8">
      <p className="text-h4 text-ink">Welcome to #{info.name}</p>
      <p className="mt-1 max-w-xl text-body-ui text-ink-secondary">
        {info.topic ? info.topic : "This is the very beginning of the channel."}
        {info.kind === "PRIVATE" ? " It's private: only the people added can see it." : ""}
      </p>
    </div>
  );
}
