"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { FileText, Paperclip, SendHorizontal, X } from "lucide-react";
import { sendTypingAction, uploadChatAttachmentAction } from "@/app/actions/chat";
import { cn } from "@/lib/cn";
import { MAX_ATTACHMENTS, MAX_MESSAGE_LENGTH, encodeMentions, triggerAt, type MentionCandidate } from "@/lib/chat/client";
import type { AttachmentDTO } from "@/lib/chat/types";
import { Avatar } from "@/components/ui/display";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat } from "@/components/chat/ChatProvider";
import { fileSize } from "@/components/chat/ui";

type Suggestion = { key: string; label: string; detail?: string; insert: string; mention?: MentionCandidate; image?: string | null };

type PendingFile = { key: string; name: string; status: "uploading" | "done"; attachment?: AttachmentDTO };

export type ComposerSubmit = { body: string; attachmentIds: string[]; raw: string };

/**
 * Message composer: Enter sends, Shift+Enter adds a line, `@` and `#` open
 * an accessible autocomplete, files attach by button, paste or drop.
 * In `edit` mode it saves with Enter and cancels with Escape.
 */
export function Composer({
  channelId,
  parentId = null,
  placeholder,
  allowBroadcast,
  allowUpload,
  mode = "post",
  initialText = "",
  initialMentions = [],
  autoFocus,
  onSubmit,
  onCancel,
  onEditLast,
}: {
  channelId: string;
  parentId?: string | null;
  placeholder: string;
  allowBroadcast: boolean;
  allowUpload: boolean;
  mode?: "post" | "edit";
  initialText?: string;
  initialMentions?: MentionCandidate[];
  autoFocus?: boolean;
  /** Return false to keep the text (e.g. the send failed). */
  onSubmit: (value: ComposerSubmit) => Promise<boolean> | boolean;
  onCancel?: () => void;
  onEditLast?: () => void;
}) {
  const { slug, people, channels, viewer } = useChat();
  const { showToast } = useToast();
  const [text, setText] = useState(initialText);
  const [mentions, setMentions] = useState<MentionCandidate[]>(initialMentions);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const listId = useId();
  const hintId = useId();

  const resize = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [text, resize]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const trigger = useMemo(() => triggerAt(text, caret), [text, caret]);
  const suggestions = useMemo((): Suggestion[] => {
    if (!trigger || dismissed === trigger.start) return [];
    const q = trigger.query.toLowerCase();
    if (trigger.trigger === "#") {
      return channels
        .filter((c) => c.slug.includes(q) || c.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((c) => ({ key: c.id, label: `#${c.name}`, insert: `#${c.slug} ` }));
    }
    const list: Suggestion[] = people
      .filter((p) => p.id !== viewer.id && p.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(q.split(" ")[0] ?? "")) && p.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((p) => ({ key: p.id, label: p.name, insert: `@${p.name} `, mention: { id: p.id, name: p.name }, image: p.image }));
    if (allowBroadcast) {
      for (const word of ["channel", "here"]) {
        if (word.startsWith(q)) list.push({ key: word, label: `@${word}`, detail: word === "channel" ? "Notify everyone in this channel" : "Notify everyone here", insert: `@${word} ` });
      }
    }
    return list;
  }, [trigger, dismissed, channels, people, viewer.id, allowBroadcast]);
  const open = suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));

  const pick = (suggestion: Suggestion) => {
    if (!trigger) return;
    const before = text.slice(0, trigger.start);
    const after = text.slice(caret);
    const next = `${before}${suggestion.insert}${after}`;
    setText(next);
    if (suggestion.mention) setMentions((current) => [...current.filter((m) => m.id !== suggestion.mention!.id), suggestion.mention!]);
    const position = before.length + suggestion.insert.length;
    setCaret(position);
    setActive(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
    });
  };

  const uploading = files.some((f) => f.status === "uploading");

  const upload = async (list: File[]) => {
    if (!allowUpload) return;
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) {
      showToast(`Attach up to ${MAX_ATTACHMENTS} files per message.`, "warning");
      return;
    }
    for (const file of list.slice(0, room)) {
      const key = `${file.name}-${Math.random().toString(36).slice(2)}`;
      setFiles((current) => [...current, { key, name: file.name, status: "uploading" }]);
      const form = new FormData();
      form.set("channelId", channelId);
      form.set("file", file);
      const result = await uploadChatAttachmentAction(slug, form);
      if (!result.ok) {
        showToast(result.error, "error");
        setFiles((current) => current.filter((f) => f.key !== key));
        continue;
      }
      setFiles((current) => current.map((f) => (f.key === key ? { ...f, status: "done", attachment: result.data!.attachment } : f)));
    }
  };

  const submit = async () => {
    if (busy || uploading) return;
    const raw = text;
    const attachmentIds = files.flatMap((f) => (f.attachment ? [f.attachment.id] : []));
    if (!raw.trim() && attachmentIds.length === 0) return;
    if (raw.length > MAX_MESSAGE_LENGTH) {
      showToast(`Keep messages under ${MAX_MESSAGE_LENGTH} characters.`, "warning");
      return;
    }
    const body = encodeMentions(raw, mentions);
    setBusy(true);
    if (mode === "post") {
      setText("");
      setFiles([]);
      setMentions([]);
    }
    const ok = await onSubmit({ body, attachmentIds, raw });
    setBusy(false);
    if (!ok && mode === "post") {
      setText(raw);
      setMentions(mentions);
    }
    if (mode === "post") area.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((activeIndex + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(suggestions[activeIndex]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(trigger?.start ?? null);
        return;
      }
    }
    if (event.key === "Escape" && mode === "edit") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key === "ArrowUp" && mode === "post" && !text && onEditLast) {
      event.preventDefault();
      onEditLast();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const onType = (value: string, position: number) => {
    setText(value);
    setCaret(position);
    setDismissed(null);
    if (mode === "post" && value && Date.now() - lastTyping.current > 4000) {
      lastTyping.current = Date.now();
      void sendTypingAction(slug, { channelId, parentId });
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files ?? []);
    if (pasted.length > 0 && allowUpload) {
      event.preventDefault();
      void upload(pasted);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!allowUpload) return;
    event.preventDefault();
    setDragging(false);
    void upload(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <div
      className={cn("relative rounded-xl border bg-panel transition-colors duration-[120ms] focus-within:border-accent", dragging ? "border-accent bg-accent-soft" : "border-line-strong")}
      onDragOver={(event) => {
        if (!allowUpload) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={trigger?.trigger === "#" ? "Channels" : "People"}
          className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-[360px] overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-float"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body-ui text-ink", index === activeIndex && "bg-muted")}
            >
              {suggestion.mention ? <Avatar name={suggestion.label} src={suggestion.image} size="xs" /> : null}
              <span className="min-w-0 flex-1 truncate font-semibold">{suggestion.label}</span>
              {suggestion.detail ? <span className="truncate text-caption text-ink-muted">{suggestion.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Files to send">
          {files.map((file) => (
            <li key={file.key} className="flex min-h-10 max-w-[260px] items-center gap-2 rounded-lg border border-line bg-surface py-1 pl-2.5 pr-1">
              {file.status === "uploading" ? <Spinner className="size-4" label="Uploading" /> : <FileText aria-hidden className="size-4 shrink-0 text-ink-muted" />}
              <span className="min-w-0 flex-1 truncate text-caption text-ink">{file.name}</span>
              {file.attachment ? <span className="text-caption text-ink-muted tabular-nums">{fileSize(file.attachment.size)}</span> : null}
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={file.status === "uploading"}
                onClick={() => setFiles((current) => current.filter((f) => f.key !== file.key))}
                className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-muted hover:text-ink disabled:text-ink-disabled"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-1 p-1.5">
        {allowUpload && mode === "post" ? (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                void upload(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach files"
              title="Attach files"
              onClick={() => fileInput.current?.click()}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink [&_svg]:size-5"
            >
              <Paperclip />
            </button>
          </>
        ) : null}
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-describedby={hintId}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
          role="combobox"
          maxLength={MAX_MESSAGE_LENGTH + 500}
          onChange={(event) => onType(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="max-h-60 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base text-ink outline-none placeholder:text-ink-muted"
        />
        {mode === "post" ? (
          <button
            type="button"
            aria-label="Send message"
            title="Send message"
            disabled={busy || uploading || (!text.trim() && !files.some((f) => f.attachment))}
            onClick={() => void submit()}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary transition-colors duration-[120ms] hover:bg-primary-hover disabled:bg-surface disabled:text-ink-muted [&_svg]:size-5"
          >
            <SendHorizontal />
          </button>
        ) : null}
      </div>
      <p id={hintId} className={cn("px-3 pb-2 text-caption text-ink-muted", mode === "post" && "sr-only sm:not-sr-only")}>
        {mode === "edit" ? (
          <span className="flex flex-wrap items-center gap-2">
            <span>Enter to save, Escape to cancel.</span>
            <Button size="sm" variant="secondary" onClick={onCancel} className="min-h-9">
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => void submit()} loading={busy} className="min-h-9">
              Save
            </Button>
          </span>
        ) : (
          <>Enter to send, Shift+Enter for a new line. Formatting: **bold**, _italic_, `code`, - lists. Type @ to mention someone.</>
        )}
      </p>
    </div>
  );
}
