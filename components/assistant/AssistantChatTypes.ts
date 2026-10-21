import type { ChatItem } from "@/lib/assistant/chat";

export type ConversationSummary = { id: string; title: string; updatedLabel: string };

export type LiveItem = ChatItem | { kind: "tool"; id: string; title: string; summary: string; error: boolean; running?: boolean };
