"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Bold, Heading2, Italic, List, ListChecks, Pin, PinOff } from "lucide-react";
import { deleteNoteAction, setNoteArchivedAction, updateNoteAction } from "@/app/actions/notepad";
import prose from "@/components/docs/DocProse.module.css";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import type { NoteDTO } from "@/lib/notepad/service";
import { NOTE_TONE_OPTIONS, toneClasses } from "./tones";

type SaveState = "saved" | "saving" | "unsaved" | "error";
const SAVE_LABEL: Record<SaveState, string> = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Couldn't save" };

/**
 * One note, edited in a dialog. Title and body autosave after a short pause;
 * the save carries the version it started from, so a newer save in another
 * tab is never overwritten silently.
 */
export function NoteEditor({ slug, note, onClose, onSaved, onRemoved }: { slug: string; note: NoteDTO; onClose: () => void; onSaved: (note: NoteDTO) => void; onRemoved: (id: string) => void }) {
  const { showToast } = useToast();
  const [title, setTitle] = useState(note.title);
  const [tone, setTone] = useState(note.tone);
  const [pinned, setPinned] = useState(note.pinned);
  const [state, setState] = useState<SaveState>("saved");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const version = useRef(note.updatedAt);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ title?: string; contentHtml?: string; tone?: NoteDTO["tone"]; pinned?: boolean }>({});

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } } }), TaskList, TaskItem.configure({ nested: true })],
    content: note.contentHtml || "<p></p>",
    editorProps: { attributes: { class: cn(prose.prose, "min-h-[240px] outline-none"), "aria-label": "Note" } },
    onUpdate: ({ editor: current }) => queue({ contentHtml: current.getHTML() }),
  });

  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const changes = pending.current;
    if (Object.keys(changes).length === 0) return;
    pending.current = {};
    setState("saving");
    try {
      const result = await updateNoteAction(slug, { id: note.id, ...changes, expectedUpdatedAt: version.current });
      if (!result.ok) {
        setState("error");
        showToast(result.error, "error");
        return;
      }
      version.current = result.data!.updatedAt;
      onSaved(result.data!);
      setState(Object.keys(pending.current).length ? "unsaved" : "saved");
    } catch {
      pending.current = { ...changes, ...pending.current };
      setState("error");
    }
  }

  function queue(changes: typeof pending.current, now = false) {
    pending.current = { ...pending.current, ...changes };
    setState("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), now ? 0 : 700);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function close() {
    await flush();
    onClose();
  }

  async function archive() {
    await flush();
    const result = await setNoteArchivedAction(slug, { id: note.id, archived: !note.archived }).catch(() => null);
    if (!result?.ok) return showToast(result?.error ?? "Couldn't archive it. Try again.", "error");
    onSaved(result.data!);
    showToast(note.archived ? "Note restored." : "Note archived.", "success");
    onClose();
  }

  async function remove() {
    const result = await deleteNoteAction(slug, { id: note.id }).catch(() => null);
    if (!result?.ok) return showToast(result?.error ?? "Couldn't delete it. Try again.", "error");
    onRemoved(note.id);
    showToast("Note deleted.", "success");
    onClose();
  }

  const active = (name: string, attrs?: Record<string, unknown>) => Boolean(editor?.isActive(name, attrs));
  const tool = "grid size-9 place-items-center rounded-md text-ink-secondary transition-colors duration-[120ms] hover:bg-muted hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent-text";

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : void close())}>
      <DialogContent size="lg" className={cn("transition-colors duration-[120ms]", toneClasses(tone))} aria-describedby={undefined}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <span className={cn("text-caption", state === "error" ? "text-danger-fg" : "text-ink-muted")} aria-live="polite">{SAVE_LABEL[state]}</span>
          <div className="flex items-center gap-1 pr-8">
            <IconButton label={pinned ? "Unpin note" : "Pin note"} variant="quiet" size="sm" aria-pressed={pinned} onClick={() => { setPinned(!pinned); queue({ pinned: !pinned }, true); }}>
              {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
            </IconButton>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <label htmlFor="note-title" className="sr-only">Title</label>
          <input
            id="note-title"
            value={title}
            maxLength={200}
            placeholder="Untitled note"
            onChange={(event) => { setTitle(event.target.value); queue({ title: event.target.value }); }}
            className="w-full bg-transparent text-h3 text-ink outline-none placeholder:text-ink-muted"
          />
          <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1">
            <button type="button" className={tool} aria-label="Heading" aria-pressed={active("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 aria-hidden className="size-4" /></button>
            <button type="button" className={tool} aria-label="Bold" aria-pressed={active("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold aria-hidden className="size-4" /></button>
            <button type="button" className={tool} aria-label="Italic" aria-pressed={active("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic aria-hidden className="size-4" /></button>
            <button type="button" className={tool} aria-label="Bulleted list" aria-pressed={active("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List aria-hidden className="size-4" /></button>
            <button type="button" className={tool} aria-label="Checklist" aria-pressed={active("taskList")} onClick={() => editor?.chain().focus().toggleTaskList().run()}><ListChecks aria-hidden className="size-4" /></button>
          </div>
          <EditorContent editor={editor} />
        </div>
        <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">Colour</legend>
            {NOTE_TONE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={tone === option.value}
                onClick={() => { setTone(option.value); queue({ tone: option.value }, true); }}
                className={cn("size-7 rounded-full border border-line-strong transition-shadow duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]", option.swatch, tone === option.value && "ring-2 ring-ink ring-offset-2 ring-offset-panel")}
              />
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            {note.archived ? <Button variant="dangerOutline" size="sm" onClick={() => setConfirmDelete(true)}>Delete…</Button> : null}
            <Button variant="neutral" size="sm" onClick={() => void archive()}>{note.archived ? "Restore" : "Archive"}</Button>
            <Button variant="primary" size="sm" onClick={() => void close()}>Done</Button>
          </div>
        </div>
      </DialogContent>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        message="It's gone for good. This can't be undone."
        confirmLabel="Delete note"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </Dialog>
  );
}
