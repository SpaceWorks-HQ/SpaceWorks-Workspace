"use client";

import { Avatar } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import type { MentionMenu } from "./docSession";

export function DocMentionMenu({ mention }: { mention: MentionMenu | null }) {
  return (
    <>
      {mention && mention.rect ? (
        <div
          role="listbox"
          aria-label="Mention a member"
          className="fixed z-50 w-64 overflow-hidden rounded-lg border border-line bg-panel p-1.5 shadow-float"
          style={{ left: Math.min(mention.rect.left, window.innerWidth - 272), top: mention.rect.bottom + 6 }}
        >
          {mention.items.length === 0 ? (
            <p className="px-3 py-2 text-caption text-ink-muted">No members match.</p>
          ) : (
            mention.items.map((member, index) => (
              <button
                key={member.id}
                type="button"
                role="option"
                aria-selected={index === mention.index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => mention.command({ id: member.id, label: member.name })}
                className={cn("flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-body-ui text-ink", index === mention.index ? "bg-muted" : "hover:bg-subtle")}
              >
                <Avatar name={member.name} size="xs" />
                <span className="truncate">{member.name}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}
