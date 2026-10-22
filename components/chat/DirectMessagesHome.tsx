"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { openDirectMessageAction } from "@/app/actions/chat";
import { formatBadge } from "@/lib/chat/client";
import { formatRelativeTime } from "@/lib/format/datetime";
import type { SidebarItem } from "@/lib/chat/types";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { NewMessageDialog } from "@/components/chat/ChannelDialogs";
import { useChat } from "@/components/chat/ChatProvider";

/** The DM landing page: recent conversations and the crew to start one with. */
export function DirectMessagesHome({ recent, startWith = [] }: { recent: SidebarItem[]; startWith?: string[] }) {
  const { slug, viewer, people, timeZone } = useChat();
  const router = useRouter();
  const { showToast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(startWith.length > 0);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const q = query.trim().toLowerCase();
  const crew = useMemo(() => people.filter((p) => p.id !== viewer.id && p.role !== "GUEST" && (!q || p.name.toLowerCase().includes(q))).slice(0, 60), [people, viewer.id, q]);

  const message = (userId: string) => {
    setOpening(userId);
    startTransition(async () => {
      const result = await openDirectMessageAction(slug, { userIds: [userId] });
      setOpening(null);
      if (!result.ok) showToast(result.error, "error");
      else router.push(result.data!.href);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h1 className="text-h4 text-ink">Direct messages</h1>
          <p className="text-caption text-ink-muted">One-to-one and small group chats. Only the people in them can read them.</p>
        </div>
        <Button variant="primary" startIcon={<Plus />} onClick={() => setDialogOpen(true)}>
          New message
        </Button>
      </header>

      <section className="px-4 py-4" aria-labelledby="dm-recent">
        <h2 id="dm-recent" className="mb-2 text-overline text-ink-muted">Recent</h2>
        {recent.length === 0 ? (
          <EmptyState patch title="No direct messages yet.">Say hello to someone from the crew below.</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {recent.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-[120ms] hover:bg-subtle">
                  <Avatar name={item.people?.[0]?.name ?? item.name} src={item.people?.[0]?.image} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className={item.unread > 0 ? "block truncate text-body-ui font-semibold text-ink" : "block truncate text-body-ui text-ink"}>{item.name}</span>
                    {item.lastMessageAt ? <span className="block text-caption text-ink-muted" suppressHydrationWarning>{formatRelativeTime(item.lastMessageAt, timeZone)}</span> : null}
                  </span>
                  {item.unread > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 text-xs font-semibold leading-5 text-accent-text tabular-nums">
                      <span className="sr-only">Unread: </span>
                      {formatBadge(item.unread)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-4 pb-6" aria-labelledby="dm-crew">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 id="dm-crew" className="text-overline text-ink-muted">The crew</h2>
          <div className="w-full sm:w-72">
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Find someone" aria-label="Find someone to message" />
          </div>
        </div>
        {crew.length === 0 ? (
          <p className="text-body-ui text-ink-muted">Nobody matches that name.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-2">
            {crew.map((person) => (
              <li key={person.id} className="flex min-h-14 items-center gap-3 rounded-lg border border-line px-3 py-2">
                <Avatar name={person.name} src={person.image} size="sm" />
                <span className="min-w-0 flex-1 truncate text-body-ui font-semibold text-ink">{person.name}</span>
                <Button size="sm" variant="secondary" loading={opening === person.id} onClick={() => message(person.id)}>
                  Message
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <NewMessageDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={startWith} />
    </div>
  );
}
