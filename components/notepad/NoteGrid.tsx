"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { createNoteAction } from "@/app/actions/notepad";
import { Patch } from "@/components/brand/Patch";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/choice";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { NoteDTO } from "@/lib/notepad/service";
import { formatRelativeTime } from "@/lib/format/datetime";
import { NoteEditor } from "./NoteEditor";
import { toneClasses } from "./tones";

type View = "notes" | "archived";

export function NoteGrid({ slug, timeZone, notes, archivedNotes, initialOpenId, onChange }: { slug: string; timeZone: string; notes: NoteDTO[]; archivedNotes: NoteDTO[]; initialOpenId: string | null; onChange: (update: (all: NoteDTO[]) => NoteDTO[]) => void }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("notes");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [creating, setCreating] = useState(false);

  const list = view === "notes" ? notes : archivedNotes;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((note) => note.title.toLowerCase().includes(q) || note.excerpt.toLowerCase().includes(q));
  }, [list, query]);
  const pinned = filtered.filter((note) => note.pinned);
  const others = filtered.filter((note) => !note.pinned);
  const open = [...notes, ...archivedNotes].find((note) => note.id === openId) ?? null;

  async function create() {
    setCreating(true);
    try {
      const result = await createNoteAction(slug, {});
      if (!result.ok) return showToast(result.error, "error");
      onChange((all) => [result.data!, ...all]);
      setView("notes");
      setOpenId(result.data!.id);
    } catch {
      showToast("Couldn't create the note. Try again.", "error");
    } finally {
      setCreating(false);
    }
  }

  const upsert = (next: NoteDTO) => onChange((all) => all.map((note) => (note.id === next.id ? next : note)));

  return (
    <section aria-labelledby="notes-heading" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="notes-heading" className="text-h4 text-ink">Notes</h2>
        <div className="flex items-center gap-2">
          <SegmentedControl<View>
            ariaLabel="Which notes"
            size="sm"
            value={view}
            onValueChange={setView}
            options={[{ value: "notes", label: "Notes" }, { value: "archived", label: `Archived${archivedNotes.length ? ` (${archivedNotes.length})` : ""}` }]}
          />
          <Button variant="primary" onClick={() => void create()} disabled={creating}>
            <Plus aria-hidden className="size-4" /> New note
          </Button>
        </div>
      </div>
      {list.length > 0 ? (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <label htmlFor="note-search" className="sr-only">Search your notes</label>
          <Input id="note-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your notes" className="pl-10" />
        </div>
      ) : null}

      {list.length === 0 ? (
        view === "notes" ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
            <Patch size={112} />
            <p className="text-label text-ink">No notes yet.</p>
            <p className="max-w-sm text-body-ui text-ink-muted">Ideas, checklists, things to remember. They stay yours: nobody else in the workspace can read them.</p>
            <Button variant="primary" className="mt-2" onClick={() => void create()} disabled={creating}>Write your first note</Button>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-panel px-5 py-6 text-center text-body-ui text-ink-muted">No archived notes.</p>
        )
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel px-5 py-6 text-center text-body-ui text-ink-muted">No notes match “{query.trim()}”.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {pinned.length > 0 ? <NoteSection label="Pinned" notes={pinned} timeZone={timeZone} onOpen={setOpenId} /> : null}
          {others.length > 0 ? <NoteSection label={pinned.length > 0 ? "Others" : null} notes={others} timeZone={timeZone} onOpen={setOpenId} /> : null}
        </div>
      )}

      {open ? (
        <NoteEditor
          key={open.id}
          slug={slug}
          note={open}
          onClose={() => setOpenId(null)}
          onSaved={upsert}
          onRemoved={(id) => onChange((all) => all.filter((note) => note.id !== id))}
        />
      ) : null}
    </section>
  );
}

function NoteSection({ label, notes, timeZone, onOpen }: { label: string | null; notes: NoteDTO[]; timeZone: string; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {label ? <h3 className="text-eyebrow uppercase tracking-[0.08em] text-ink-muted">{label}</h3> : null}
      <ul className="columns-1 gap-3 sm:columns-2 xl:columns-3">
        {notes.map((note) => (
          <li key={note.id} className="mb-3 break-inside-avoid">
            <button
              type="button"
              onClick={() => onOpen(note.id)}
              className={cn(
                "flex w-full flex-col gap-2 rounded-xl border border-line p-4 text-left transition-colors duration-[120ms] hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]",
                toneClasses(note.tone),
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className={cn("text-label", note.title ? "text-ink" : "text-ink-muted")}>{note.title || "Untitled note"}</span>
                {note.pinned ? <span className="inline-flex items-center justify-center text-xs font-semibold">Pinned</span> : null}
              </span>
              {note.excerpt ? <span className="line-clamp-6 whitespace-pre-line text-body-ui text-ink-secondary">{note.excerpt}</span> : null}
              <span className="flex items-center justify-between gap-2 text-caption text-ink-muted">
                <span>{formatRelativeTime(note.updatedAt, timeZone)}</span>
                {note.checklist.total > 0 ? <span className="tabular-nums">{note.checklist.done}/{note.checklist.total} checked</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
