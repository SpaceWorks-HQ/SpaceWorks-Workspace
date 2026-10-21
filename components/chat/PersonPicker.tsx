"use client";

import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/field";
import { roleLabel, isWorkspaceRole } from "@/lib/roles";
import type { ChatPerson } from "@/lib/chat/types";

/**
 * Multi-select list of workspace members with a filter box. Selected people
 * show as removable chips above the list.
 */
export function PersonPicker({
  people,
  selected,
  onChange,
  exclude = [],
  max,
  label = "Find people",
}: {
  people: Array<ChatPerson & { role?: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  max?: number;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const q = query.trim().toLowerCase();
  const matches = people.filter((p) => !excluded.has(p.id) && (!q || p.name.toLowerCase().includes(q))).slice(0, 50);
  const full = max !== undefined && selected.length >= max;

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else if (!full) onChange([...selected, id]);
  };

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected people">
          {selected.map((id) => {
            const person = byId.get(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 text-label text-ink hover:bg-muted"
                  aria-label={`Remove ${person?.name ?? "person"}`}
                >
                  <Avatar name={person?.name} src={person?.image} size="xs" />
                  <span className="max-w-[160px] truncate">{person?.name ?? "Former member"}</span>
                  <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search by name" aria-label={label} aria-controls={listId} />
      <ul id={listId} className="max-h-64 overflow-y-auto rounded-lg border border-line" aria-label="People">
        {matches.length === 0 ? <li className="px-3 py-4 text-center text-body-ui text-ink-muted">Nobody matches that name.</li> : null}
        {matches.map((person) => {
          const checked = selected.includes(person.id);
          return (
            <li key={person.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={!checked && full}
                onClick={() => toggle(person.id)}
                className={cn("flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-subtle disabled:text-ink-disabled", checked && "bg-accent-soft hover:bg-accent-soft")}
              >
                <Avatar name={person.name} src={person.image} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-ui font-semibold text-ink">{person.name}</span>
                  {person.role && isWorkspaceRole(person.role) ? <span className="block text-caption text-ink-muted">{roleLabel(person.role)}</span> : null}
                </span>
                <span aria-hidden className={cn("inline-flex size-5 items-center justify-center rounded-sm border", checked ? "border-accent-text bg-primary text-on-primary" : "border-line-strong bg-panel")}>
                  {checked ? <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">✓</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {max !== undefined ? <p className="text-caption text-ink-muted">Up to {max} people.</p> : null}
    </div>
  );
}
