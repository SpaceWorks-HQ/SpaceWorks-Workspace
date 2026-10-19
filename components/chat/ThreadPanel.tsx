"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { editMessageAction, loadThreadAction, markReadAction, postMessageAction } from "@/app/actions/chat";
import type { ChannelInfo, MessageDTO } from "@/lib/chat/types";
import { ConfirmDialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/button";
import { Skeleton, EmptyState } from "@/components/ui/display";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat, useChatEvents } from "@/components/chat/ChatProvider";
import { Composer } from "@/components/chat/Composer";
import { MessageItem } from "@/components/chat/MessageItem";
import { useMessageActions } from "@/components/chat/useMessageActions";
import { continuesPrevious, mergeMessages } from "@/components/chat/ui";

/** A thread beside (or, on small screens, over) the timeline. */
export function ThreadPanel({
  info,
  parentId,
  highlightId,
  onClose,
  onRootChanged,
}: {
  info: ChannelInfo;
  parentId: string;
  highlightId?: string | null;
  onClose: () => void;
  onRootChanged: (root: MessageDTO) => void;
}) {
  const { slug, timeZone, viewer } = useChat();
  const { showToast } = useToast();
  const [root, setRoot] = useState<MessageDTO | null>(null);
  const [replies, setReplies] = useState<MessageDTO[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [typing, setTyping] = useState<{ name: string; until: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onRootChangedRef = useRef(onRootChanged);
  useEffect(() => {
    onRootChangedRef.current = onRootChanged;
  }, [onRootChanged]);

  const apply = useCallback((result: Awaited<ReturnType<typeof loadThreadAction>>) => {
    if (!result.ok) {
      setState("missing");
      return;
    }
    setRoot(result.data!.root);
    setReplies(result.data!.replies);
    setState("ready");
    onRootChangedRef.current(result.data!.root);
  }, []);

  const load = useCallback(() => loadThreadAction(slug, { channelId: info.id, parentId }).then(apply), [slug, info.id, parentId, apply]);

  useEffect(() => {
    let alive = true;
    loadThreadAction(slug, { channelId: info.id, parentId }).then((result) => {
      if (alive) apply(result);
    });
    return () => {
      alive = false;
    };
  }, [slug, info.id, parentId, apply]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || state !== "ready") return;
    if (highlightId && replies.some((r) => r.id === highlightId) && stick.current) {
      document.getElementById(`thread-${highlightId}`)?.scrollIntoView({ block: "center" });
      stick.current = false;
      return;
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [replies, state, highlightId]);

  useChatEvents((event) => {
    if (event.type === "chat.reconnected" || event.type === "chat.visible") {
      void load();
      return;
    }
    if (event.channel !== `channel:${info.id}`) return;
    const data = event.data ?? {};
    if (event.type === "typing" && data.parentId === parentId && data.userId !== viewer.id) {
      setTyping({ name: String(data.name ?? "Someone"), until: Date.now() + 6000 });
      return;
    }
    const touchesThread = data.parentId === parentId || data.messageId === parentId;
    if (!touchesThread) return;
    if (event.type === "message.created" && event.actorId === viewer.id) return;
    void load();
    if (event.type === "message.created") setTyping(null);
  });

  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => setTyping(null), Math.max(0, typing.until - Date.now()));
    return () => clearTimeout(timer);
  }, [typing]);

  const onChanged = useCallback(
    (message: MessageDTO) => {
      if (message.id === parentId) {
        setRoot(message);
        onRootChangedRef.current(message);
      } else setReplies((current) => mergeMessages(current, [message]));
    },
    [parentId],
  );
  const onDeleted = useCallback(
    (message: MessageDTO) => {
      if (message.id === parentId) void load();
      else setReplies((current) => current.filter((m) => m.id !== message.id));
    },
    [parentId, load],
  );
  const { actions, confirmDelete, setConfirmDelete, deleting, confirm } = useMessageActions({
    href: info.href,
    onChanged,
    onDeleted,
    onEdit: (message) => setEditingId(message.id),
  });

  const send = async ({ body, attachmentIds }: { body: string; attachmentIds: string[] }) => {
    const result = await postMessageAction(slug, { channelId: info.id, body, parentId, attachmentIds });
    if (!result.ok) {
      showToast(result.error, "error");
      return false;
    }
    stick.current = true;
    setReplies((current) => mergeMessages(current, [result.data!.message]));
    setRoot((current) => (current ? { ...current, replyCount: current.replyCount + 1, lastReplyAt: result.data!.message.createdAt } : current));
    if (info.isMember) void markReadAction(slug, { channelId: info.id });
    return true;
  };

  const saveEdit = (message: MessageDTO) => async ({ body }: { body: string }) => {
    const result = await editMessageAction(slug, { messageId: message.id, body });
    if (!result.ok) {
      showToast(result.error, "error");
      return false;
    }
    onChanged(result.data!.message);
    setEditingId(null);
    return true;
  };

  const render = (message: MessageDTO, previous?: MessageDTO) => (
    <div key={message.id} id={`thread-${message.id}`}>
      <MessageItem
        message={message}
        compact={continuesPrevious(previous, message, timeZone)}
        highlighted={message.id === highlightId}
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
    </div>
  );

  return (
    <section aria-label="Thread" className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 items-center justify-between gap-2 border-b border-line pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="text-title text-ink">Thread</h2>
          <p className="truncate text-caption text-ink-muted">{info.kind === "DIRECT" ? info.name : `#${info.name}`}</p>
        </div>
        <IconButton label="Close thread" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto py-3"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {state === "loading" ? (
          <div className="flex flex-col gap-3 px-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        ) : state === "missing" || !root ? (
          <EmptyState className="mx-4" title="This thread isn't available any more.">
            The message may have been deleted.
          </EmptyState>
        ) : (
          <>
            {render(root)}
            <div className="my-2 flex items-center gap-3 px-4" role="separator">
              <span className="text-caption text-ink-muted tabular-nums">{root.replyCount === 1 ? "1 reply" : `${root.replyCount} replies`}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            {replies.map((reply, index) => render(reply, replies[index - 1]))}
          </>
        )}
      </div>
      {state === "ready" && root && !root.deleted ? (
        <div className="border-t border-line p-3">
          {info.can.post ? (
            <Composer channelId={info.id} parentId={parentId} placeholder="Reply in thread" allowBroadcast={false} allowUpload={info.can.upload} onSubmit={send} autoFocus />
          ) : (
            <p className="text-body-ui text-ink-muted">{info.archived ? "This channel is archived, so the thread is read-only." : "Join the channel to reply."}</p>
          )}
          <p aria-live="polite" className="min-h-5 pt-1 text-caption text-ink-muted">
            {typing ? `${typing.name} is typing…` : ""}
          </p>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this message?"
        message="It's removed for everyone. This can't be undone."
        confirmLabel="Delete message"
        loading={deleting}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}
