"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { WorkspaceRole } from "@prisma/client";
import type { RealtimeEvent } from "@/lib/realtimeTypes";
import type { ChannelOption, ChatPerson } from "@/lib/chat/types";

/**
 * Shared state for the chat area: who is viewing, the workspace's people and
 * channels (for mentions and pickers), and one realtime stream that every
 * chat component subscribes to.
 *
 * The stream is a dedicated EventSource so it can report reconnects: after a
 * dropped connection, subscribers get a `{ type: "chat.reconnected" }` event
 * and fetch whatever they missed.
 */

export type ChatViewer = { id: string; name: string; role: WorkspaceRole };

type Listener = (event: RealtimeEvent) => void;

type ChatContextValue = {
  slug: string;
  timeZone: string;
  viewer: ChatViewer;
  people: Array<ChatPerson & { role: string }>;
  channels: ChannelOption[];
  subscribe: (listener: Listener) => () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside <ChatProvider>.");
  return value;
}

/** Subscribe to chat realtime events for the lifetime of a component. */
export function useChatEvents(listener: Listener) {
  const { subscribe } = useChat();
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  }, [listener]);
  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}

export function ChatProvider({
  slug,
  timeZone,
  viewer,
  people,
  channels,
  children,
}: {
  slug: string;
  timeZone: string;
  viewer: ChatViewer;
  people: Array<ChatPerson & { role: string }>;
  channels: ChannelOption[];
  children: ReactNode;
}) {
  const listeners = useRef(new Set<Listener>());

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let connectedOnce = false;
    const emit = (event: RealtimeEvent) => {
      for (const listener of listeners.current) {
        try {
          listener(event);
        } catch {
          // One faulty listener must not stop the others.
        }
      }
    };
    const source = new EventSource(`/api/realtime/${encodeURIComponent(slug)}`);
    const onReady = () => {
      if (connectedOnce) emit({ type: "chat.reconnected", channel: "workspace", at: new Date().toISOString() });
      connectedOnce = true;
    };
    const onMessage = (message: MessageEvent<string>) => {
      try {
        emit(JSON.parse(message.data) as RealtimeEvent);
      } catch {
        // Ignore malformed events.
      }
    };
    // Coming back to a backgrounded tab: catch up even if the stream survived.
    const onVisible = () => {
      if (document.visibilityState === "visible") emit({ type: "chat.visible", channel: "workspace", at: new Date().toISOString() });
    };
    source.addEventListener("ready", onReady);
    source.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      source.removeEventListener("ready", onReady);
      source.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
      source.close();
    };
  }, [slug]);

  const value = useMemo(() => ({ slug, timeZone, viewer, people, channels, subscribe }), [slug, timeZone, viewer, people, channels, subscribe]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
