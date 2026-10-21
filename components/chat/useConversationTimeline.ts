"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadMessagesAction, loadMessagesByIdsAction, markReadAction } from "@/app/actions/chat";
import { firstUnreadId } from "@/lib/chat/client";
import type { ChannelInfo, MessagePage } from "@/lib/chat/types";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat, useChatEvents } from "./ChatProvider";
import { mergeMessages } from "./ui";

export type ConversationPanel = { type: "thread"; parentId: string; highlightId?: string | null } | { type: "pinned" } | { type: "details" } | { type: "search" } | null;

type PendingSend = { key: string; text: string };

export function useConversationTimeline({ info, initial, initialThreadId, highlightId }: {
  info: ChannelInfo;
  initial: MessagePage;
  initialThreadId: string | null;
  highlightId: string | null;
}) {
  const { slug, viewer } = useChat();
  const router = useRouter();
  const { showToast } = useToast();
  const [messages, setMessages] = useState(initial.messages);
  const [hasOlder, setHasOlder] = useState(initial.hasOlder);
  const [hasNewer, setHasNewer] = useState(initial.hasNewer);
  const [loading, setLoading] = useState<"older" | "newer" | "latest" | null>(null);
  const [divider] = useState(() => firstUnreadId(initial.messages.map((m) => ({ id: m.id, createdAt: m.createdAt, authorId: m.author?.id ?? null })), info.lastReadAt, viewer.id));
  const [panel, setPanel] = useState<ConversationPanel>(initialThreadId ? { type: "thread", parentId: initialThreadId, highlightId } : null);
  const [highlight, setHighlight] = useState<string | null>(initialThreadId ? null : highlightId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [atBottom, setAtBottom] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const stickRef = useRef(!highlightId && !divider);
  const prependFrom = useRef<number | null>(null);
  const pendingCountRef = useRef(0);
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
    } else if (stickRef.current) {
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
      if (document.visibilityState !== "visible" || hasNewerRef.current || !stickRef.current) return;
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
    stickRef.current = true;
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
    // More than a page arrived while away: start again from the latest page.
    const gap = latest.length > 0 && loadedIds.current.size > 0 && result.data!.hasOlder && !latest.some((m) => loadedIds.current.has(m.id));
    if (gap) {
      setHasOlder(true);
      setMessages(latest);
    } else {
      setMessages((current) => mergeMessages(current, latest));
    }
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
        else if (messageId && !hasNewerRef.current && !(event.actorId === viewer.id && pendingCountRef.current > 0)) enqueue(messageId, true);
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

  return {
    messages,
    setMessages,
    hasOlder,
    hasNewer,
    loading,
    divider,
    panel,
    setPanel,
    highlight,
    setHighlight,
    editingId,
    setEditingId,
    pending,
    setPending,
    typing,
    atBottom,
    setAtBottom,
    scroller,
    topSentinel,
    stickRef,
    pendingCountRef,
    hasNewerRef,
    loadedIds,
    scheduleRead,
    loadOlder,
    loadNewer,
    jumpToLatest,
    enqueue,
  };
}
