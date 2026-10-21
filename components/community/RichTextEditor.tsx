"use client";

import { useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";

/**
 * Small rich-text editor for announcements: headings, emphasis, lists,
 * quotes and links. The HTML it emits is sanitised again on the server.
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  label,
}: {
  id: string;
  value: string;
  onChange: (html: string) => void;
  invalid?: boolean;
  describedBy?: string;
  label: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, link: { openOnClick: false, autolink: true, protocols: ["mailto"] } })],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        ...(invalid ? { "aria-invalid": "true" } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        class: "yy-prose min-h-48 px-3.5 py-3 focus:outline-none",
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
            heading: current.isActive("heading", { level: 2 }),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
            link: current.isActive("link"),
          }
        : null,
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");

  const tool = (labelText: string, active: boolean | undefined, run: () => void, icon?: React.ReactNode) => (
    <button
      type="button"
      aria-label={icon ? labelText : undefined}
      title={labelText}
      aria-pressed={Boolean(active)}
      disabled={!editor}
      onClick={run}
      className={cn(
        "inline-flex min-h-11 min-w-11 px-2 items-center justify-center rounded-md text-xs font-semibold text-ink-secondary transition-colors duration-[120ms] hover:bg-muted hover:text-ink [&_svg]:size-5",
        active && "bg-accent-soft text-accent-text",
      )}
    >
      {icon ?? labelText}
    </button>
  );

  const applyLink = () => {
    if (!editor) return;
    const url = href.trim();
    if (!url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-line-strong bg-panel transition-colors duration-[120ms] focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--yy-focus)]",
        invalid && "border-danger-fg",
      )}
    >
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-1.5 py-1">
        {tool("Bold", state?.bold, () => editor?.chain().focus().toggleBold().run(), <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">B</span>)}
        {tool("Italic", state?.italic, () => editor?.chain().focus().toggleItalic().run(), <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">I</span>)}
        {tool("Heading", state?.heading, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">H2</span>)}
        {tool("List", state?.bullet, () => editor?.chain().focus().toggleBulletList().run())}
        {tool("Numbered list", state?.ordered, () => editor?.chain().focus().toggleOrderedList().run(), <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">1.</span>)}
        {tool("Quote", state?.quote, () => editor?.chain().focus().toggleBlockquote().run())}
        <Popover
          open={linkOpen}
          onOpenChange={(open) => {
            setLinkOpen(open);
            if (open) setHref(editor?.getAttributes("link").href ?? "");
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Link"
              aria-pressed={Boolean(state?.link)}
              disabled={!editor}
              className={cn("inline-flex min-h-11 min-w-11 px-2 items-center justify-center rounded-md text-xs font-semibold text-ink-secondary hover:bg-muted hover:text-ink [&_svg]:size-5", state?.link && "bg-accent-soft text-accent-text")}
            >
              <span className="inline-flex items-center justify-center text-xs font-semibold">Link</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <form
              className="flex flex-col gap-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                applyLink();
              }}
            >
              <label htmlFor={`${id}-link`} className="text-label text-ink">Link address</label>
              <Input id={`${id}-link`} value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://" autoFocus />
              <div className="flex justify-end gap-2">
                {state?.link ? (
                  <Button size="sm" variant="quiet" startIcon={null} onClick={() => { setHref(""); editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }}>
                    Remove
                  </Button>
                ) : null}
                <Button size="sm" variant="primary" type="submit">Apply</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
