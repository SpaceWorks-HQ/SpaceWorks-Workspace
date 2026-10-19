"use client";

import { useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Minus, Quote, Redo2, Strikethrough, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** Only http(s), mailto and site-relative paths; the server sanitiser enforces the same. */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^mailto:/i.test(value) || /^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value)) return `https://${value}`;
  return null;
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-colors duration-[120ms] ease-yy [&_svg]:size-[18px]",
        active ? "bg-accent-soft text-accent-text" : "text-ink-secondary hover:bg-muted hover:text-ink",
        "disabled:pointer-events-none disabled:text-ink-disabled",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line" />;

function Toolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-2 py-1.5">
      <ToolButton label="Heading" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolButton>
      <ToolButton label="Subheading" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 /></ToolButton>
      <Divider />
      <ToolButton label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}><Bold /></ToolButton>
      <ToolButton label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}><Italic /></ToolButton>
      <ToolButton label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough /></ToolButton>
      <ToolButton label="Inline code" active={state.code} onClick={() => chain().toggleCode().run()}><Code /></ToolButton>
      <ToolButton label="Link" active={state.link} onClick={onLink}><LinkIcon /></ToolButton>
      <Divider />
      <ToolButton label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}><List /></ToolButton>
      <ToolButton label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></ToolButton>
      <ToolButton label="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}><Quote /></ToolButton>
      <ToolButton label="Divider line" onClick={() => chain().setHorizontalRule().run()}><Minus /></ToolButton>
      <Divider />
      <ToolButton label="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}><Undo2 /></ToolButton>
      <ToolButton label="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}><Redo2 /></ToolButton>
    </div>
  );
}

/**
 * The blog body editor: tiptap StarterKit (h2–h4, lists, quotes, code,
 * links, rules). The HTML it emits is sanitised again on the server.
 */
export function RichTextEditor({ initialHtml, onChange, labelledBy }: { initialHtml: string; onChange: (html: string) => void; labelledBy: string }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | undefined>();
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }, codeBlock: {} })],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: "yy-prose min-h-[40vh] px-5 py-4 focus:outline-none",
        "aria-labelledby": labelledBy,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });

  const openLink = () => {
    setHref(editor?.getAttributes("link").href ?? "");
    setLinkError(undefined);
    setLinkOpen(true);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-panel focus-within:border-accent">
      {editor ? <Toolbar editor={editor} onLink={openLink} /> : <div className="h-[52px] border-b border-line bg-surface" />}
      {editor ? <EditorContent editor={editor} /> : <div className="yy-prose min-h-[40vh] px-5 py-4" dangerouslySetInnerHTML={{ __html: initialHtml }} />}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!editor) return;
              if (!href.trim()) {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setLinkOpen(false);
                return;
              }
              const url = normalizeLink(href);
              if (!url) {
                setLinkError("Use a web address (https://…), an email (mailto:…) or a path starting with /.");
                return;
              }
              editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
              setLinkOpen(false);
            }}
          >
            <DialogHeader title="Link" description="Leave it empty to remove the link." />
            <DialogBody>
              <Field label="Address" error={linkError}>
                <Input value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://spaceworks.example" autoFocus />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setLinkOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Save link</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
