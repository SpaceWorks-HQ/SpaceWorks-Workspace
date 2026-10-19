"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveView, deleteView } from "@/app/actions/views";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ActionButton } from "@/components/notification-center/ActionButton";
export type ViewSummary = {
  id: string;
  name: string;
  ownerId: string;
  query: unknown;
};
export function SavedViews({
  slug,
  userId,
  entityType,
  filters,
  views,
  base,
}: {
  slug: string;
  userId: string;
  entityType: string;
  filters: Record<string, string>;
  views: ViewSummary[];
  base: string;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <details className="rounded-xl border border-line bg-panel p-4">
      <summary className="min-h-11 cursor-pointer text-label">
        Saved views
      </summary>
      <ul className="flex flex-wrap gap-3 py-3">
        {views.map((v) => {
          const q =
            v.query && typeof v.query === "object" && "filters" in v.query
              ? v.query.filters
              : {};
          const params = new URLSearchParams();
          if (q && typeof q === "object")
            for (const [key, value] of Object.entries(q))
              if (typeof value === "string") params.set(key, value);
          return (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`${base}?${params}`}
              >
                {v.name}
              </Link>
              {v.ownerId === userId ? (
                <ActionButton
                  action={() => deleteView(slug, v.id)}
                  confirm={`Remove ${v.name}?`}
                >
                  Remove…
                </ActionButton>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            try {
              const r = await saveView(slug, {
                entityType,
                name,
                query: { filters },
              });
              setMessage(r.ok ? "View saved." : r.error);
              if (r.ok) {
                setName("");
                router.refresh();
              }
            } catch {
              setMessage("Couldn't save this view. Try again.");
            }
          });
        }}
      >
        <Field label="View name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
          />
        </Field>
        <Button type="submit" variant="secondary" loading={pending}>
          Save current view
        </Button>
      </form>
      <p role="status" className="mt-2 text-caption">
        {message}
      </p>
    </details>
  );
}
