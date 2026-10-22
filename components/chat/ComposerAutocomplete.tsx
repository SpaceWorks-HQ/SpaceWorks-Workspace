"use client";

import { useMemo } from "react";
import { Avatar } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import type { MentionCandidate, triggerAt } from "@/lib/chat/client";
import type { useChat } from "./ChatProvider";

export type Suggestion = { key: string; label: string; detail?: string; insert: string; mention?: MentionCandidate; image?: string | null };

export function useComposerSuggestions({
  trigger,
  dismissed,
  channels,
  people,
  viewer,
  allowBroadcast,
}: {
  trigger: ReturnType<typeof triggerAt>;
  dismissed: number | null;
  channels: ReturnType<typeof useChat>["channels"];
  people: ReturnType<typeof useChat>["people"];
  viewer: ReturnType<typeof useChat>["viewer"];
  allowBroadcast: boolean;
}) {
  return useMemo((): Suggestion[] => {
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
}

export function ComposerAutocomplete({
  listId,
  trigger,
  suggestions,
  activeIndex,
  pick,
  setActive,
}: {
  listId: string;
  trigger: ReturnType<typeof triggerAt>;
  suggestions: Suggestion[];
  activeIndex: number;
  pick: (suggestion: Suggestion) => void;
  setActive: (index: number) => void;
}) {
  return (
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
  );
}
