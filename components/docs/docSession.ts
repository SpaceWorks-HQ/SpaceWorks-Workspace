"use client";

import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { EditorView } from "@tiptap/pm/view";
import { saveDocAction } from "@/app/actions/docs";
import { uploadFile } from "@/lib/files/uploadClient";

export type DocMember = { id: string; name: string };
export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";
export type MentionMenu = { items: DocMember[]; index: number; rect: DOMRect | null; command: (item: { id: string; label: string }) => void };

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const SAVE_DELAY_MS = 1200;
const RETRY_DELAY_MS = 5000;

type Callbacks = {
  setStatus: (status: SaveStatus) => void;
  setMention: (menu: MentionMenu | null) => void;
  setImageProgress: (fraction: number | null) => void;
  notifyError: (message: string) => void;
  onReloaded: (title: string) => void;
};

/**
 * Imperative editing session for one doc, kept outside React state: the
 * TipTap extensions (mentions read the member list live), debounced
 * autosave with the version check, and image uploads. The component
 * creates it once and forwards editor events to it.
 */
export function createDocSession(init: { slug: string; docId: string; version: string; title: string; currentUserId: string; members: DocMember[]; canEdit: boolean; callbacks: Callbacks }) {
  const cb = init.callbacks;
  let version = init.version;
  let title = init.title;
  let lastSent = { title: init.title, html: "" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let again = false;
  let conflict = false;
  let reloadRequested = false;
  let mention: MentionMenu | null = null;
  let members = init.members;
  let editor: Editor | null = null;

  const setMention = (next: MentionMenu | null) => {
    mention = next;
    cb.setMention(next);
  };

  async function save() {
    if (conflict || !editor || editor.isDestroyed) return;
    if (saving) {
      again = true;
      return;
    }
    const html = editor.getHTML();
    const nextTitle = title;
    if (html === lastSent.html && nextTitle === lastSent.title) {
      cb.setStatus("saved");
      return;
    }
    saving = true;
    cb.setStatus("saving");
    const result = await saveDocAction(init.slug, { docId: init.docId, title: nextTitle, html, baseVersion: version }).catch(() => ({ ok: false as const, error: "offline" }));
    saving = false;
    if (result.ok) {
      version = result.data.version;
      lastSent = { title: nextTitle, html };
      if (again || (editor && !editor.isDestroyed && editor.getHTML() !== html) || title !== nextTitle) {
        again = false;
        void save();
      } else {
        cb.setStatus("saved");
      }
      return;
    }
    if ("conflict" in result && result.conflict) {
      conflict = true;
      cb.setStatus("conflict");
      return;
    }
    cb.setStatus("error");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), RETRY_DELAY_MS);
  }

  function schedule() {
    if (conflict) return;
    cb.setStatus("dirty");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DELAY_MS);
  }

  async function uploadImages(files: File[], position?: number) {
    for (const file of files.filter((item) => IMAGE_TYPES.includes(item.type))) {
      cb.setImageProgress(0);
      const result = await uploadFile(init.slug, file, { docId: init.docId, folder: "/Doc images" }, (fraction) => cb.setImageProgress(fraction));
      cb.setImageProgress(null);
      if (!result.ok || !result.file.url) cb.notifyError(result.ok ? "Couldn't add the image. Try again." : result.error);
      else editor?.chain().focus(position).setImage({ src: result.file.url, alt: result.file.filename ?? file.name }).run();
    }
  }

  const hasImages = (files: File[]) => files.some((file) => IMAGE_TYPES.includes(file.type));

  const extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ allowBase64: false }),
    Placeholder.configure({ placeholder: init.canEdit ? "Write something, or type @ to mention a member" : "" }),
    Mention.configure({
      HTMLAttributes: { class: "mention" },
      suggestion: {
        char: "@",
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return members.filter((member) => member.id !== init.currentUserId && member.name.toLowerCase().includes(q)).slice(0, 6);
        },
        render: () => {
          const show = (props: SuggestionProps<DocMember, { id: string; label: string }>) =>
            setMention({ items: props.items, index: mention && mention.items.length === props.items.length ? Math.min(mention.index, props.items.length - 1) : 0, rect: props.clientRect?.() ?? null, command: props.command });
          return {
            onStart: show,
            onUpdate: show,
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (!mention || mention.items.length === 0) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setMention({ ...mention, index: (mention.index + delta + mention.items.length) % mention.items.length });
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const item = mention.items[mention.index];
                if (item) mention.command({ id: item.id, label: item.name });
                return true;
              }
              if (event.key === "Escape") {
                setMention(null);
                return true;
              }
              return false;
            },
            onExit: () => setMention(null),
          };
        },
      },
    }),
  ];

  const handlers = {
    handlePaste: (_view: EditorView, event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!init.canEdit || !hasImages(files)) return false;
      void uploadImages(files);
      return true;
    },
    handleDrop: (view: EditorView, event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!init.canEdit || !hasImages(files)) return false;
      event.preventDefault();
      void uploadImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
      return true;
    },
  };

  return {
    extensions,
    handlers,
    attach(next: Editor) {
      editor = next;
      lastSent = { title, html: next.getHTML() };
    },
    schedule,
    setTitle(next: string) {
      title = next;
      schedule();
    },
    setMembers(next: DocMember[]) {
      members = next;
    },
    uploadImages,
    get version() {
      return version;
    },
    get title() {
      return title;
    },
    requestReload() {
      reloadRequested = true;
    },
    /** Swap in a fresh server copy after "Reload" (no-op otherwise). */
    applyServerCopy(doc: { version: string; title: string; html: string }) {
      if (!reloadRequested || !editor || doc.version === version) return;
      reloadRequested = false;
      conflict = false;
      version = doc.version;
      title = doc.title;
      editor.commands.setContent(doc.html, { emitUpdate: false });
      lastSent = { title: doc.title, html: editor.getHTML() };
      cb.setStatus("saved");
      cb.onReloaded(doc.title);
    },
    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
}

export type DocSession = ReturnType<typeof createDocSession>;
