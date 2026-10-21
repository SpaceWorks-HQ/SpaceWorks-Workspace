"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";

import { sendTypingAction } from "@/app/actions/chat";
import { cn } from "@/lib/cn";
import { MAX_MESSAGE_LENGTH, encodeMentions, triggerAt, type MentionCandidate } from "@/lib/chat/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/feedback/ToastProvider";
import { useChat } from "@/components/chat/ChatProvider";
import { useComposerAttachments } from "./useComposerAttachments";
import { ComposerAttachments } from "./ComposerAttachments";
import { ComposerAutocomplete, useComposerSuggestions, type Suggestion } from "./ComposerAutocomplete";

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
  const { files, setFiles, uploading, upload } = useComposerAttachments(slug, channelId, allowUpload);
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
  const suggestions = useComposerSuggestions({ trigger, dismissed, channels, people, viewer, allowBroadcast });
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
        <ComposerAutocomplete
          listId={listId}
          trigger={trigger}
          suggestions={suggestions}
          activeIndex={activeIndex}
          pick={pick}
          setActive={setActive}
        />
      ) : null}

      {files.length > 0 ? (
        <ComposerAttachments
          files={files}
          onRemove={(key) => setFiles((current) => current.filter((f) => f.key !== key))}
        />
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
              title="Attach files"
              onClick={() => fileInput.current?.click()}
              className="inline-flex min-h-11 min-w-11 shrink-0 px-3 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink [&_svg]:size-5"
            >
              <span className="inline-flex items-center justify-center text-xs font-semibold">Attach</span>
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
          className="max-h-60 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base text-ink outline-none placeholder:text-ink-muted"
        />
        {mode === "post" ? (
          <button
            type="button"
            title="Send message"
            disabled={busy || uploading || (!text.trim() && !files.some((f) => f.attachment))}
            onClick={() => void submit()}
            className="inline-flex min-h-11 min-w-11 shrink-0 px-3 items-center justify-center rounded-md bg-primary text-on-primary transition-colors duration-[120ms] hover:bg-primary-hover disabled:bg-surface disabled:text-ink-muted [&_svg]:size-5"
          >
            <span className="inline-flex items-center justify-center text-xs font-semibold">Send</span>
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
