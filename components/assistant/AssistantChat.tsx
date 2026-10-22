"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createConversationAction, deleteConversationAction, renameConversationAction } from "@/app/actions/assistant";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { cn } from "@/lib/cn";
import type { ChatItem, ChatStreamEvent, PendingCall } from "@/lib/assistant/chat";

import type { ConversationSummary, LiveItem } from "./AssistantChatTypes";
import { ConversationList } from "./ConversationList";
import { AssistantMessages } from "./AssistantMessages";

export type { ConversationSummary } from "./AssistantChatTypes";

async function readEvents(response: Response, onEvent: (event: ChatStreamEvent) => void) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = chunk.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      } catch {
        // Ignore a malformed frame.
      }
    }
  }
}

export function AssistantChat({
  slug,
  conversations,
  active,
  configured,
  setupHref,
}: {
  slug: string;
  conversations: ConversationSummary[];
  active: { id: string; title: string; items: ChatItem[]; pending: PendingCall[]; tokens: number } | null;
  configured: boolean;
  setupHref: string | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [conversationId, setConversationId] = useState(active?.id ?? null);
  const [title, setTitle] = useState(active?.title ?? "New conversation");
  const [items, setItems] = useState<LiveItem[]>(active?.items ?? []);
  const [pending, setPending] = useState<PendingCall[]>(active?.pending ?? []);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const [actionPending, startTransition] = useTransition();
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [items, pending]);

  useEffect(() => () => abort.current?.abort(), []);

  const handleEvent = useCallback((event: ChatStreamEvent) => {
    switch (event.type) {
      case "text":
        setItems((all) => {
          const last = all.at(-1);
          if (last?.kind === "assistant" && last.id.startsWith("live-")) return [...all.slice(0, -1), { ...last, text: last.text + event.text }];
          return [...all, { kind: "assistant", id: `live-${Date.now()}-${all.length}`, text: event.text }];
        });
        break;
      case "tool":
        setItems((all) => {
          const card: LiveItem = { kind: "tool", id: `tool-${event.tool.id}`, title: event.tool.title, summary: event.tool.summary ?? "Working", error: event.tool.status === "error", running: event.tool.status === "running" };
          const existing = all.findIndex((item) => item.id === card.id);
          if (existing >= 0) return all.map((item, i) => (i === existing ? card : item));
          return [...all, card];
        });
        break;
      case "confirm":
        setPending(event.calls);
        break;
      case "title":
        setTitle(event.title);
        break;
      case "error":
        setError(event.message);
        break;
      case "done":
        break;
    }
  }, []);

  const send = useCallback(
    async (body: { text?: string; decision?: "approve" | "decline" }) => {
      setError(null);
      let id = conversationId;
      if (!id) {
        const created = await createConversationAction(slug);
        if (!created.ok || !created.data) {
          setError(created.ok ? "Couldn't start a conversation. Try again." : created.error);
          return;
        }
        id = created.data.id;
        setConversationId(id);
        window.history.replaceState(null, "", `/w/${slug}/assistant/c/${id}`);
      }
      if (body.text) setItems((all) => [...all, { kind: "user", id: `user-${Date.now()}`, text: body.text! }]);
      setPending([]);
      setStreaming(true);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const response = await fetch(`/w/${slug}/assistant/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: id, ...body }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(payload?.error ?? "The assistant couldn't answer. Try again.");
        } else {
          await readEvents(response, handleEvent);
        }
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("The connection dropped. Try again.");
      } finally {
        setStreaming(false);
        abort.current = null;
        router.refresh();
      }
    },
    [conversationId, handleEvent, router, slug],
  );

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    void send({ text });
  };

  const stop = () => {
    abort.current?.abort();
    setStreaming(false);
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) showToast(result.error ?? "Couldn't save. Try again.", "error");
      else {
        showToast(success, "success");
        after?.();
        router.refresh();
      }
    });

  const composer = (
    <form
      className="flex flex-col gap-2 border-t border-line bg-panel p-3 sm:p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="assistant-message" className="sr-only">Message the assistant</label>
      <Textarea
        id="assistant-message"
        rows={2}
        value={draft}
        maxLength={8000}
        disabled={!configured}
        placeholder={pending.length ? "Confirm or cancel the change above, or ask something else" : "Ask about tasks, people, docs or events"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        className="min-h-[72px]"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption text-ink-muted">Enter to send, Shift + Enter for a new line.</span>
        {streaming ? (
          <Button variant="secondary" onClick={stop}>Stop</Button>
        ) : (
          <Button type="submit" variant="primary" disabled={!configured || !draft.trim()}>Send</Button>
        )}
      </div>
    </form>
  );

  return (
    <div className="grid gap-6 md:grid-cols-[256px_minmax(0,1fr)]">
      <aside className={cn("md:block", conversationId ? "hidden" : "block")}>
        <ConversationList
          slug={slug}
          conversations={conversations}
          conversationId={conversationId}
          setRenaming={setRenaming}
          setDeleting={setDeleting}
        />
      </aside>
      <Card padding="none" className="flex min-h-[560px] flex-col overflow-hidden md:h-[calc(100dvh-260px)]">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          {conversationId ? (
            <IconButton label="All conversations" size="sm" className="md:hidden" onClick={() => router.push(`/w/${slug}/assistant`)}>
              <ArrowLeft />
            </IconButton>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate text-title text-ink">{conversationId ? title : "Space Works Assistant"}</h2>
          {active && active.tokens > 0 ? <span className="shrink-0 text-caption tabular-nums text-ink-muted">{active.tokens.toLocaleString("en-IN")} tokens</span> : null}
        </header>
        <AssistantMessages
          configured={configured}
          setupHref={setupHref}
          items={items}
          streaming={streaming}
          pending={pending}
          error={error}
          bottom={bottom}
          send={send}
        />
        {composer}
      </Card>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader title="Rename conversation" />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = String(new FormData(event.currentTarget).get("title") ?? "");
              const target = renaming;
              if (!target) return;
              act(() => renameConversationAction(slug, { conversationId: target.id, title: value }), "Conversation renamed.", () => {
                if (target.id === conversationId) setTitle(value.trim());
                setRenaming(null);
              });
            }}
          >
            <DialogBody>
              <Field label="Title"><Input name="title" defaultValue={renaming?.title} maxLength={120} required autoFocus /></Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={actionPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this conversation?"
        message="The messages are removed for good. Anything the assistant created stays."
        confirmLabel="Delete conversation"
        loading={actionPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          act(() => deleteConversationAction(slug, { conversationId: target.id }), "Conversation deleted.", () => {
            setDeleting(null);
            if (target.id === conversationId) router.push(`/w/${slug}/assistant`);
          });
        }}
      />
    </div>
  );
}
