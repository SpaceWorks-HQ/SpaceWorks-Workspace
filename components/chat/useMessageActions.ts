"use client";

import { useMemo, useState } from "react";
import { deleteMessageAction, setPinnedAction, toggleReactionAction } from "@/app/actions/chat";
import type { MessageDTO } from "@/lib/chat/types";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat } from "@/components/chat/ChatProvider";
import type { MessageActions } from "@/components/chat/MessageItem";

/**
 * Shared handlers for message toolbars (timeline and thread). `onChanged`
 * receives the fresh DTO after a reaction or pin; `onDeleted` the id.
 */
export function useMessageActions(options: {
  href: string;
  onChanged: (message: MessageDTO) => void;
  onDeleted: (message: MessageDTO) => void;
  onEdit: (message: MessageDTO) => void;
  onReply?: (message: MessageDTO) => void;
}) {
  const { slug } = useChat();
  const { showToast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState<MessageDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { href, onChanged, onDeleted, onEdit, onReply } = options;

  const actions = useMemo<MessageActions>(
    () => ({
      onReact: async (message, emoji) => {
        const result = await toggleReactionAction(slug, { messageId: message.id, emoji });
        if (result.ok) onChanged(result.data!.message);
        else showToast(result.error, "error");
      },
      onPin: async (message, pinned) => {
        const result = await setPinnedAction(slug, { messageId: message.id, pinned });
        if (result.ok) {
          onChanged(result.data!.message);
          showToast(pinned ? "Pinned to the channel." : "Unpinned.", "success");
        } else showToast(result.error, "error");
      },
      onEdit,
      onReply,
      onDelete: (message) => setConfirmDelete(message),
      onCopyLink: async (message) => {
        const url = new URL(message.parentId ? `${href}?thread=${message.parentId}&m=${message.id}` : `${href}?m=${message.id}`, window.location.origin).toString();
        try {
          await navigator.clipboard.writeText(url);
          showToast("Link copied.", "success");
        } catch {
          showToast("Couldn't copy the link. Copy it from the address bar instead.", "error");
        }
      },
    }),
    [slug, href, onChanged, onEdit, onReply, showToast],
  );

  const confirm = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const result = await deleteMessageAction(slug, { messageId: confirmDelete.id });
    setDeleting(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    onDeleted(confirmDelete);
    setConfirmDelete(null);
  };

  return { actions, confirmDelete, setConfirmDelete, deleting, confirm };
}
