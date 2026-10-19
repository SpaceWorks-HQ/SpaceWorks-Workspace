"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/display";
import { controlClasses } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { encodeMentions } from "@/lib/tasks/mentions";
import type { PersonRef } from "@/lib/tasks/types";

const TRIGGER = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u;

/**
 * Plain-text comment box with @mentions. Typing "@" opens a list of
 * people; arrow keys move, Enter or Tab picks, Escape closes. Picked
 * names are stored as `<@userId>` tokens. Ctrl/Cmd+Enter sends.
 */
export function MentionComposer({
  people,
  initialText = "",
  initialPicked = [],
  submitLabel = "Comment",
  placeholder = "Write a comment. Type @ to mention someone.",
  busy = false,
  onSubmit,
  onCancel,
  autoFocus = false,
}: {
  people: PersonRef[];
  initialText?: string;
  initialPicked?: Array<{ id: string; name: string }>;
  submitLabel?: string;
  placeholder?: string;
  busy?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [picked, setPicked] = useState(initialPicked);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const matches = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return people.filter((person) => (person.name ?? "").toLowerCase().includes(needle)).slice(0, 8);
  }, [people, query]);
  const open = query !== null && matches.length > 0;

  const detect = (value: string, caret: number) => {
    const match = TRIGGER.exec(value.slice(0, caret));
    setQuery(match ? match[2]! : null);
    setActive(0);
  };

  const pick = (person: PersonRef) => {
    const el = textarea.current;
    if (!el || !person.name) return;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@[\p{L}\p{N}._-]{0,30}$/u, `@${person.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((list) => (list.some((item) => item.id === person.id) ? list : [...list, { id: person.id, name: person.name! }]));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    const body = encodeMentions(text.trim(), picked);
    if (!body || busy) return;
    if (await onSubmit(body)) {
      setText("");
      setPicked([]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <textarea
          ref={textarea}
          value={text}
          rows={3}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="Comment"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          maxLength={5000}
          className={cn(controlClasses, "min-h-20 resize-y")}
          onChange={(event) => {
            setText(event.target.value);
            detect(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyDown={(event) => {
            if (open) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => (index + 1) % matches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => (index - 1 + matches.length) % matches.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                pick(matches[active]!);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setQuery(null);
                return;
              }
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape" && onCancel) onCancel();
          }}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
        />
        <ul id={listId} role="listbox" aria-label="People to mention" hidden={!open} className="absolute left-0 top-full z-20 mt-1 w-[min(300px,100%)] rounded-lg border border-line bg-panel p-1.5 shadow-float">
          {matches.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 text-body-ui text-ink", index === active && "bg-muted")}
            >
              <Avatar name={person.name} src={person.image} size="xs" />
              <span className="truncate">{person.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        <Button variant="primary" size="sm" onClick={() => void submit()} loading={busy} disabled={!text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
