"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createFeedAction, revokeFeedAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout, Card, Chip } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import type { FeedScope } from "@/lib/community/validation";

type FeedRow = { scope: FeedScope; title: string; description: string; activeSince: string | null };

/**
 * One row per feed: create, copy (shown once), regenerate or turn off. The
 * URL is a password for your calendar, so it is only displayed right after
 * it is made; regenerating breaks the old one.
 */
export function FeedManager({ slug, feeds }: { slug: string; feeds: FeedRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [fresh, setFresh] = useState<{ scope: FeedScope; url: string; webcalUrl: string } | null>(null);
  const [revoking, setRevoking] = useState<FeedScope | null>(null);

  const create = (scope: FeedScope) =>
    startTransition(async () => {
      const result = await createFeedAction(slug, { scope });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setFresh({ scope, ...result.data! });
      router.refresh();
    });

  const revoke = (scope: FeedScope) =>
    startTransition(async () => {
      const result = await revokeFeedAction(slug, { scope });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setRevoking(null);
      if (fresh?.scope === scope) setFresh(null);
      showToast("Feed turned off. The old link no longer works.", "success");
      router.refresh();
    });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast("Link copied.", "success");
    } catch {
      showToast("Couldn't copy. Select the link and copy it yourself.", "error");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {feeds.map((feed) => {
        const shown = fresh?.scope === feed.scope ? fresh : null;
        return (
          <Card key={feed.scope} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-title text-ink">{feed.title}</h2>
                <p className="mt-1 text-body-ui text-ink-muted">{feed.description}</p>
              </div>
              {feed.activeSince ? <Chip tone="success" size="sm">On since {feed.activeSince}</Chip> : <Chip tone="outline" size="sm">Off</Chip>}
            </div>
            {shown ? (
              <Callout tone="success" title="Here's your private link. Copy it now: it won't be shown again.">
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input readOnly value={shown.url} aria-label={`${feed.title} link`} onFocus={(event) => event.currentTarget.select()} />
                  <Button variant="secondary" startIcon={null} onClick={() => copy(shown.url)}>Copy</Button>
                </div>
                <p className="mt-2 text-caption">
                  Google Calendar: Other calendars, then From URL. Apple Calendar:{" "}
                  <a href={shown.webcalUrl} className="font-semibold underline underline-offset-4">open the subscription</a>.
                </p>
              </Callout>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {feed.activeSince ? (
                <>
                  <Button variant="secondary" onClick={() => create(feed.scope)} loading={pending && !revoking}>Get a new link</Button>
                  <Button variant="dangerOutline" onClick={() => setRevoking(feed.scope)} disabled={pending}>Turn off…</Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => create(feed.scope)} loading={pending}>Create link</Button>
              )}
            </div>
          </Card>
        );
      })}
      <ConfirmDialog
        open={revoking !== null}
        title="Turn off this feed?"
        message="Calendars subscribed with the current link stop updating. You can create a new link any time."
        confirmLabel="Turn off feed"
        loading={pending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => revoking && revoke(revoking)}
      />
    </div>
  );
}
