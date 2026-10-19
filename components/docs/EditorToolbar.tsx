"use client";

import { useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  CodeXml,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

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
        "inline-flex size-11 shrink-0 items-center [@media(pointer:fine)]:size-9 justify-center rounded-md transition-colors duration-[120ms] ease-yy [&_svg]:size-[18px]",
        active ? "bg-accent-soft text-accent-text" : "text-ink-secondary hover:bg-muted hover:text-ink",
        "disabled:pointer-events-none disabled:text-ink-disabled",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line" />;

/** Only http(s), mailto and in-app paths; the server sanitiser enforces the same. */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^mailto:/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value)) return `https://${value}`;
  return null;
}

/**
 * Formatting toolbar for the doc editor. Every control is a labelled button
 * (aria-pressed for toggles) and keeps editor focus; table tools appear
 * while the cursor is in a table.
 */
export function EditorToolbar({ editor, onPickImage, imageBusy }: { editor: Editor; onPickImage: () => void; imageBusy: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();

  const openLink = () => {
    setLinkValue((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkError(null);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = normalizeLink(linkValue);
    if (!href) {
      setLinkError("Use a web address (https://…), an email (mailto:…) or a page path (/w/…).");
      return;
    }
    if (editor.state.selection.empty && !state.link) chain().insertContent({ type: "text", text: linkValue.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    else chain().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  };

  return (
    <>
      <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto sm:flex-wrap sm:overflow-visible">
        <Dropdown
          aria-label="Text style"
          value={state.block}
          className="w-[140px] shrink-0 [@media(pointer:fine)]:!min-h-9"
          onChange={(event) => {
            const value = event.target.value;
            if (value === "p") chain().setParagraph().run();
            else chain().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
          }}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </Dropdown>
        <Divider />
        <ToolButton label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}><Bold /></ToolButton>
        <ToolButton label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}><Italic /></ToolButton>
        <ToolButton label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough /></ToolButton>
        <ToolButton label="Inline code" active={state.code} onClick={() => chain().toggleCode().run()}><Code /></ToolButton>
        <ToolButton label={state.link ? "Edit link" : "Add link"} active={state.link} onClick={openLink}><Link /></ToolButton>
        <Divider />
        <ToolButton label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}><List /></ToolButton>
        <ToolButton label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></ToolButton>
        <ToolButton label="Checklist" active={state.task} onClick={() => chain().toggleTaskList().run()}><ListChecks /></ToolButton>
        <ToolButton label="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}><Quote /></ToolButton>
        <ToolButton label="Code block" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}><CodeXml /></ToolButton>
        <ToolButton label="Divider" onClick={() => chain().setHorizontalRule().run()}><Minus /></ToolButton>
        <Divider />
        <ToolButton label="Insert table" active={state.table} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></ToolButton>
        <ToolButton label={imageBusy ? "Uploading image" : "Insert image"} disabled={imageBusy} onClick={onPickImage}><ImagePlus /></ToolButton>
        <Divider />
        <ToolButton label="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}><Undo2 /></ToolButton>
        <ToolButton label="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}><Redo2 /></ToolButton>
      </div>
      {state.table ? (
        <div role="toolbar" aria-label="Table" className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
          <span className="mr-1 text-caption text-ink-muted">Table</span>
          <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().addRowAfter().run()}>Add row</Button>
          <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().addColumnAfter().run()}>Add column</Button>
          <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().deleteRow().run()}>Remove row</Button>
          <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().deleteColumn().run()}>Remove column</Button>
          <Button size="sm" variant="dangerQuiet" onMouseDown={(event) => event.preventDefault()} onClick={() => chain().deleteTable().run()}>Remove table</Button>
        </div>
      ) : null}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent size="sm">
          <DialogHeader title={state.link ? "Edit link" : "Add link"} />
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              applyLink();
            }}
          >
            <DialogBody>
              <Field label="Link to" error={linkError ?? undefined} helperText="A web address, an email or a page in this workspace.">
                <Input value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="https://tinkerspace.in" autoFocus inputMode="url" />
              </Field>
            </DialogBody>
            <DialogFooter>
              {state.link ? (
                <Button
                  variant="dangerQuiet"
                  onClick={() => {
                    chain().extendMarkRange("link").unsetLink().run();
                    setLinkOpen(false);
                  }}
                >
                  Remove link
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setLinkOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Save link</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
