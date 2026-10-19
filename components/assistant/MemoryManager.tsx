"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createMemoryAction, deleteMemoryAction, updateMemoryAction } from "@/app/actions/assistant";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, SearchInput, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

type MemoryRow = { id: string; content: string; tags: string[]; source: string; by: string | null; updated: string };

const SOURCE_LABEL: Record<string, string> = { manual: "Added by hand", assistant: "Saved by the assistant", job: "Saved by a job" };

const splitTags = (value: string) => value.split(",").map((tag) => tag.trim()).filter(Boolean);

export function MemoryManager({ slug, query, memories }: { slug: string; query: string; memories: MemoryRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [editing, setEditing] = useState<{ id: string; content: string; tags: string } | null>(null);
  const [deleting, setDeleting] = useState<MemoryRow | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) showToast(result.error ?? "Couldn't save. Try again.", "error");
      else {
        after?.();
        showToast(success, "success");
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Teach the assistant" description="Short facts the assistant can look up for everyone, like opening hours or where the spare filament lives. Never store passwords or contact details." />
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            act(() => createMemoryAction(slug, { content, tags: splitTags(tags) }), "Saved to memory.", () => {
              setContent("");
              setTags("");
            });
          }}
        >
          <Field label="Fact"><Textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} maxLength={1000} required /></Field>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="Tags" optional helperText="Comma separated, e.g. space, hours."><Input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} /></Field>
            <Button type="submit" variant="primary" loading={pending}>Save memory</Button>
          </div>
        </form>
      </Card>

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(search.trim() ? `${pathname}?q=${encodeURIComponent(search.trim())}` : pathname);
        }}
      >
        <label htmlFor="memory-search" className="sr-only">Search memory</label>
        <SearchInput id="memory-search" value={search} placeholder="Search memory" onChange={(e) => setSearch(e.target.value)} onClear={() => { setSearch(""); router.push(pathname); }} />
      </form>

      {memories.length === 0 ? (
        <EmptyState title={query ? "Nothing in memory matches that." : "Nothing in memory yet."}>
          {query ? "Try other words or clear the search." : "Add a fact above, or ask the assistant to remember something in chat."}
        </EmptyState>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {memories.map((memory) => (
              <li key={memory.id} className="flex flex-col gap-2 px-5 py-4">
                {editing?.id === memory.id ? (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      act(() => updateMemoryAction(slug, { memoryId: memory.id, content: editing.content, tags: splitTags(editing.tags) }), "Memory updated.", () => setEditing(null));
                    }}
                  >
                    <Field label="Fact" hideLabel><Textarea rows={2} value={editing.content} maxLength={1000} onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></Field>
                    <Field label="Tags"><Input value={editing.tags} maxLength={200} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} /></Field>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" variant="primary" loading={pending}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-body-ui text-ink [overflow-wrap:anywhere]">{memory.content}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {memory.tags.map((tag) => <Chip key={tag} size="sm" tone="outline">{tag}</Chip>)}
                      <span className="text-caption text-ink-muted">
                        {SOURCE_LABEL[memory.source] ?? "Saved"}
                        {memory.by ? ` · ${memory.by}` : ""} · {memory.updated}
                      </span>
                      <span className="ml-auto flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing({ id: memory.id, content: memory.content, tags: memory.tags.join(", ") })}>Edit</Button>
                        <Button size="sm" variant="dangerOutline" onClick={() => setDeleting(memory)}>Delete…</Button>
                      </span>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this memory?"
        message="The assistant won't find it any more."
        confirmLabel="Delete memory"
        loading={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && act(() => deleteMemoryAction(slug, { memoryId: deleting.id }), "Memory deleted.", () => setDeleting(null))}
      />
    </div>
  );
}
