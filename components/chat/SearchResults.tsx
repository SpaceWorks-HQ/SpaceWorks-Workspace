"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Hash, Lock } from "lucide-react";
import { searchMessagesAction } from "@/app/actions/chat";
import { formatDayTime } from "@/lib/format/datetime";
import type { SearchHit } from "@/lib/chat/types";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/choice";
import { useChat } from "@/components/chat/ChatProvider";
import { messageBodyClass } from "@/components/chat/ui";

/**
 * Message search. Inside a conversation it can switch between "This
 * conversation" and "Everywhere"; on the search page it is always everywhere.
 */
export function SearchResults({ channel, autoFocus, initialQuery = "", onNavigate }: { channel?: { id: string; label: string }; autoFocus?: boolean; initialQuery?: string; onNavigate?: () => void }) {
  const { slug, timeZone } = useChat();
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<"here" | "all">(channel ? "here" : "all");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (scopeValue = scope) => {
    if (query.trim().length < 2) {
      setError("Type at least two characters.");
      return;
    }
    startTransition(async () => {
      const result = await searchMessagesAction(slug, { query, ...(channel && scopeValue === "here" ? { channelId: channel.id } : {}) });
      if (!result.ok) {
        setError(result.error);
        setHits(null);
        return;
      }
      setError(null);
      setHits(result.data!);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form
        role="search"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <SearchInput
              value={query}
              autoFocus={autoFocus}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => {
                setQuery("");
                setHits(null);
              }}
              placeholder="Search messages"
              aria-label="Search messages"
              maxLength={200}
            />
          </div>
          <Button type="submit" variant="primary" loading={pending} loadingLabel="Searching…">
            Search
          </Button>
        </div>
        {channel ? (
          <SegmentedControl
            ariaLabel="Search in"
            size="sm"
            className="self-start"
            value={scope}
            onValueChange={(value) => {
              setScope(value);
              if (hits) run(value);
            }}
            options={[
              { value: "here", label: channel.label },
              { value: "all", label: "Everywhere" },
            ]}
          />
        ) : null}
        {error ? <p role="alert" className="text-caption text-danger-fg">{error}</p> : null}
      </form>
      <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto">
        {hits === null ? (
          <p className="text-body-ui text-ink-muted">Find words, names or links from any conversation you can read. Use quotes for an exact phrase.</p>
        ) : hits.length === 0 ? (
          <EmptyState title="Nothing matches that search.">Try fewer words or a different spelling.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            <li className="text-caption text-ink-muted">{hits.length === 1 ? "1 result" : `${hits.length} results`}</li>
            {hits.map((hit) => (
              <li key={hit.id}>
                <Link
                  href={hit.href}
                  onClick={onNavigate}
                  className="block rounded-lg border border-line bg-panel p-3 transition-colors duration-[120ms] hover:bg-subtle"
                >
                  <span className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
                    <span className="inline-flex items-center gap-1 font-semibold text-ink">
                      {hit.channelKind === "PRIVATE" ? <Lock aria-hidden className="size-3.5" /> : hit.channelKind === "PUBLIC" ? <Hash aria-hidden className="size-3.5" /> : null}
                      {hit.channelName}
                    </span>
                    {hit.inThread ? <span>in a thread</span> : null}
                    <span className="tabular-nums">{formatDayTime(hit.createdAt, timeZone)}</span>
                  </span>
                  <span className="flex gap-2.5">
                    <Avatar name={hit.author?.name ?? "Space Works"} src={hit.author?.image} size="xs" className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-label text-ink">{hit.author?.name ?? "Space Works"}</span>
                      <span className={`${messageBodyClass} line-clamp-4 block`} dangerouslySetInnerHTML={{ __html: hit.html }} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
