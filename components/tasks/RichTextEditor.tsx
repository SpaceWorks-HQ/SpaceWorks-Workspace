"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Heading2, Heading3, Italic, List, ListOrdered, Quote, Strikethrough } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Rich text for task descriptions (tiptap starter kit: headings 2–3, bold,
 * italic, strike, code, lists, quotes, links). The server sanitises
 * whatever this produces (lib/tasks/sanitize.ts) before storing it.
 */
export function RichTextEditor({ initialHtml, onChange, label = "Description", autoFocus = false }: { initialHtml: string; onChange: (html: string) => void; label?: string; autoFocus?: boolean }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } })],
    content: initialHtml,
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: "yy-prose min-h-36 px-3.5 py-3 text-[15px] focus:outline-none",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.isEmpty ? "" : current.getHTML()),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            strike: current.isActive("strike"),
            code: current.isActive("code"),
            h2: current.isActive("heading", { level: 2 }),
            h3: current.isActive("heading", { level: 3 }),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
          }
        : null,
  });

  const tool = (name: string, icon: ReactNode, active: boolean | undefined, run: () => void) => (
    <button
      type="button"
      key={name}
      aria-label={name}
      title={name}
      aria-pressed={Boolean(active)}
      disabled={!editor}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-ink-secondary transition-colors duration-[120ms] hover:bg-muted hover:text-ink [&_svg]:size-4",
        active && "bg-accent-soft text-accent-text",
      )}
    >
      {icon}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-panel focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--yy-focus)]">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5 border-b border-line bg-surface px-1.5 py-1">
        {tool("Bold", <Bold />, state?.bold, () => editor?.chain().focus().toggleBold().run())}
        {tool("Italic", <Italic />, state?.italic, () => editor?.chain().focus().toggleItalic().run())}
        {tool("Strikethrough", <Strikethrough />, state?.strike, () => editor?.chain().focus().toggleStrike().run())}
        {tool("Inline code", <Code />, state?.code, () => editor?.chain().focus().toggleCode().run())}
        {tool("Heading", <Heading2 />, state?.h2, () => editor?.chain().focus().toggleHeading({ level: 2 }).run())}
        {tool("Subheading", <Heading3 />, state?.h3, () => editor?.chain().focus().toggleHeading({ level: 3 }).run())}
        {tool("Bulleted list", <List />, state?.bullet, () => editor?.chain().focus().toggleBulletList().run())}
        {tool("Numbered list", <ListOrdered />, state?.ordered, () => editor?.chain().focus().toggleOrderedList().run())}
        {tool("Quote", <Quote />, state?.quote, () => editor?.chain().focus().toggleBlockquote().run())}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

/** Stored (sanitised) HTML. */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  // The HTML was sanitised on the server with an allow-list before it was stored.
  return <div className={cn("yy-prose text-[15px]", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
