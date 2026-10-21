"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleCheck, Ellipsis, Plus, TriangleAlert } from "lucide-react";
import { createConversationAction, deleteConversationAction, renameConversationAction } from "@/app/actions/assistant";
import { Button, IconButton } from "@/components/ui/button";
import { Callout, Card, EmptyState } from "@/components/ui/display";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/feedback/ToastProvider";
import { Markdown } from "@/components/assistant/Markdown";
import { cn } from "@/lib/cn";
import type { ChatItem, ChatStreamEvent, PendingCall } from "@/lib/assistant/chat";

export type ConversationSummary = { id: string; title: string; updatedLabel: string };

type LiveItem = ChatItem | { kind: "tool"; id: string; title: string; summary: string; error: boolean; running?: boolean };

const SUGGESTIONS = ["What's due this week?", "Who can help with soldering?", "Summarise the latest announcements", "What happened in #general today?"];

function previewInput(input: unknown): Array<[string, string]> {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]);
}

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

  const list = (
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
      <aside className={cn("md:block", conversationId ? "hidden" : "block")}>{list}</aside>
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
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-live="polite" aria-busy={streaming}>
          {!configured ? (
            <Callout tone="warning" title="The assistant isn't set up yet." className="mb-4">
              {setupHref ? (
                <>Add an Anthropic API key in <Link href={setupHref} className="font-semibold underline">instance settings</Link> to switch it on.</>
              ) : (
                "Ask your instance admin to add an AI key in instance settings."
              )}
            </Callout>
          ) : null}
          {items.length === 0 ? (
            configured ? (
            <EmptyState patch title="Ask the assistant about the workspace." className="border-none" action={
              <Menu>
                <MenuTrigger asChild><Button variant="secondary" disabled={streaming}>Choose a prompt</Button></MenuTrigger>
                <MenuContent align="center">
                {SUGGESTIONS.map((suggestion) => (
                  <MenuItem key={suggestion} onSelect={() => void send({ text: suggestion })} disabled={streaming}>
                    {suggestion}
                  </MenuItem>
                ))}
                </MenuContent>
              </Menu>
            } />
            ) : null
          ) : (
            <ol className="flex flex-col gap-4">
              {items.map((item) => (
                <li key={item.id} className={cn("flex", item.kind === "user" ? "justify-end" : "justify-start")}>
                  {item.kind === "user" ? (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-4 py-2.5 text-body-ui text-on-primary [overflow-wrap:anywhere]">{item.text}</div>
                  ) : item.kind === "assistant" ? (
                    <div className="max-w-[92%]">
                      <span className="mb-1 block text-caption font-semibold text-ink-muted">Assistant</span>
                      <Markdown source={item.text} />
                    </div>
                  ) : (
                    <div className={cn("inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-caption", item.error ? "border-danger-border text-danger-fg" : "border-line bg-surface text-ink-secondary")}>
                      {"running" in item && item.running ? <Spinner className="size-3.5" /> : item.error ? <TriangleAlert aria-hidden className="size-3.5" /> : <CircleCheck aria-hidden className="size-3.5 text-accent-text" />}
                      <span className="font-semibold text-ink">{item.title}</span>
                      <span className="truncate">{item.summary}</span>
                    </div>
                  )}
                </li>
              ))}
              {streaming && items.at(-1)?.kind === "user" ? (
                <li className="flex items-center gap-2 text-caption text-ink-muted"><Spinner className="size-4" /> Thinking</li>
              ) : null}
            </ol>
          )}
          {pending.length > 0 && !streaming ? (
            <section aria-label="Confirm changes" className="mt-4 rounded-lg border-[1.5px] border-accent-text bg-panel p-4">
              <h3 className="text-label text-ink">Confirm {pending.length === 1 ? "this change" : "these changes"}</h3>
              <ul className="mt-2 flex flex-col gap-3">
                {pending.map((call) => (
                  <li key={call.id}>
                    <p className="text-body-ui font-semibold text-ink">{call.title}</p>
                    <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-caption sm:grid-cols-[max-content_minmax(0,1fr)]">
                      {previewInput(call.input).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-ink-muted">{key}</dt>
                          <dd className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void send({ decision: "approve" })}>Confirm</Button>
                <Button variant="secondary" onClick={() => void send({ decision: "decline" })}>Cancel</Button>
              </div>
            </section>
          ) : null}
          {error ? <Callout tone="danger" role="alert" className="mt-4">{error}</Callout> : null}
          <div ref={bottom} />
        </div>
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
