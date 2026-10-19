"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/choice";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";

export type MultiSelectItem = { id: string; label: string; leading?: ReactNode; description?: string };

/**
 * Checkbox list in a popover (assignees, labels, filters). With
 * `commitOnClose` the selection is applied once when the popover closes,
 * so picking three people is one save, not three.
 */
export function MultiSelect({
  trigger,
  title,
  items,
  selected,
  onChange,
  commitOnClose = false,
  searchPlaceholder,
  emptyText = "Nothing to pick yet.",
  align = "start",
  disabled = false,
}: {
  trigger: ReactNode;
  title: string;
  items: MultiSelectItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  commitOnClose?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  align?: "start" | "end";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [query, setQuery] = useState("");
  const listId = useId();
  const current = commitOnClose ? draft : selected;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  const toggle = (id: string) => {
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    if (commitOnClose) setDraft(next);
    else onChange(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        if (next) {
          setDraft(selected);
          setQuery("");
        } else if (commitOnClose) {
          const changed = draft.length !== selected.length || draft.some((id) => !selected.includes(id));
          if (changed) onChange(draft);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(320px,calc(100vw-32px))] p-0">
        <div className="border-b border-line px-3 pb-2 pt-3">
          <p className="text-overline text-ink-muted">{title}</p>
          {items.length > 6 ? (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder ?? "Search"}
              aria-label={searchPlaceholder ?? `Search ${title.toLowerCase()}`}
              aria-controls={listId}
              className="mt-2 block min-h-10 w-full rounded-md border border-line-strong bg-panel px-3 text-body-ui text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
          ) : null}
        </div>
        <ul id={listId} className="max-h-72 overflow-y-auto p-1.5" aria-label={title}>
          {visible.length === 0 ? <li className="px-3 py-2 text-body-ui text-ink-muted">{emptyText}</li> : null}
          {visible.map((item) => {
            const checked = current.includes(item.id);
            const controlId = `${listId}-${item.id}`;
            return (
              <li key={item.id}>
                <label htmlFor={controlId} className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body-ui text-ink hover:bg-muted")}>
                  <Checkbox id={controlId} checked={checked} onCheckedChange={() => toggle(item.id)} />
                  {item.leading ? <span aria-hidden className="inline-flex shrink-0">{item.leading}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.description ? <span className="block truncate text-caption text-ink-muted">{item.description}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
