"use client";

import Link from "next/link";
import { Ellipsis, Plus } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import type { ConversationSummary } from "./AssistantChatTypes";

export function ConversationList({
  slug,
  conversations,
  conversationId,
  setRenaming,
  setDeleting,
}: {
  slug: string;
  conversations: ConversationSummary[];
  conversationId: string | null;
  setRenaming: (conversation: ConversationSummary) => void;
  setDeleting: (conversation: ConversationSummary) => void;
}) {
  return (
    <nav aria-label="Conversations" className="flex flex-col gap-2">
      <Button variant="primary" startIcon={<Plus />} fullWidth asChild>
        <Link href={`/w/${slug}/assistant`}>New conversation</Link>
      </Button>
      {conversations.length === 0 ? (
        <p className="px-1 py-3 text-caption text-ink-muted">Your conversations show up here.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {conversations.map((conversation) => {
            const current = conversation.id === conversationId;
            return (
              <li key={conversation.id} className={cn("group flex items-center gap-1 rounded-md", current ? "bg-accent-soft" : "hover:bg-subtle")}>
                <Link href={`/w/${slug}/assistant/c/${conversation.id}`} aria-current={current ? "page" : undefined} className="min-w-0 flex-1 px-3 py-2.5">
                  <span className={cn("block truncate text-body-ui", current ? "font-semibold text-accent-text" : "text-ink")}>{conversation.title}</span>
                  <span className="block text-caption text-ink-muted">{conversation.updatedLabel}</span>
                </Link>
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton label={`Options for ${conversation.title}`} size="sm">
                      <Ellipsis />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => setRenaming(conversation)}>Rename</MenuItem>
                    <MenuItem danger onSelect={() => setDeleting(conversation)}>Delete…</MenuItem>
                  </MenuContent>
                </Menu>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
