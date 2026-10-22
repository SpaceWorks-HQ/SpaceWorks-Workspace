"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  editMessageAction,
  joinChannelAction,
  leaveChannelAction,
  openDirectMessageAction,
  postMessageAction,
  updateChannelAction,
} from "@/app/actions/chat";
import { cn } from "@/lib/cn";
import { extractUserMentions } from "@/lib/chat/client";
import type { ChannelInfo, MessageDTO, MessagePage } from "@/lib/chat/types";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat } from "@/components/chat/ChatProvider";
import { Composer, type ComposerSubmit } from "@/components/chat/Composer";
import { DetailsPanel, PinnedPanel, SearchPanel } from "@/components/chat/ChannelPanels";
import { ThreadPanel } from "@/components/chat/ThreadPanel";
import { ConversationHeader } from "./ConversationHeader";
import { ConversationTimeline } from "./ConversationTimeline";
import { useConversationTimeline } from "./useConversationTimeline";
import { useMessageActions } from "@/components/chat/useMessageActions";
import { mergeMessages } from "@/components/chat/ui";

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
  const timeline = useConversationTimeline({ info, initial, initialThreadId, highlightId });
  const {
    messages, setMessages, hasNewer, loading, panel, setPanel,
    setHighlight, setEditingId, setPending, typing, atBottom,
    scroller, stickRef, pendingCountRef, hasNewerRef, loadedIds, jumpToLatest, enqueue,
  } = timeline;

  // ── Actions ──
  const replace = useCallback((message: MessageDTO) => {
    if (message.parentId) return;
    setMessages((current) => mergeMessages(current, [message]));
  }, [setMessages]);
  const removeLocal = useCallback((message: MessageDTO) => {
    if (message.parentId) return;
    if (message.replyCount > 0) enqueue(message.id);
    else setMessages((current) => current.filter((m) => m.id !== message.id));
  }, [enqueue, setMessages]);
  const openThread = useCallback((message: MessageDTO) => {
    setPanel({ type: "thread", parentId: message.id });
    window.history.replaceState(null, "", `${info.href}?thread=${message.id}`);
  }, [info.href, setPanel]);
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
    pendingCountRef.current += 1;
    stickRef.current = true;
    setPending((current) => [...current, { key, text: raw || "Sharing a file" }]);
    const result = await postMessageAction(slug, { channelId: info.id, body, parentId: null, attachmentIds });
    pendingCountRef.current -= 1;
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
        <ConversationHeader info={info} viewerId={viewer.id} backHref={backHref} panel={panel} setPanel={setPanel} />

        <ConversationTimeline info={info} timeZone={timeZone} timeline={timeline} actions={actions} saveEdit={saveEdit} />

        {(hasNewer || !atBottom) && messages.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center">
            <Button
              size="sm"
              variant="secondary"
              className="pointer-events-auto shadow-float"
              startIcon={null}
              loading={loading === "latest"}
              onClick={() => {
                if (hasNewer) void jumpToLatest();
                else {
                  stickRef.current = true;
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
            {typingNames.length === 1 ? `${typingNames[0]} is typing` : typingNames.length > 1 ? "Several people are typing" : ""}
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
                  stickRef.current = false;
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
