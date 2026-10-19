import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FeedManager } from "@/components/community/FeedManager";
import { PageHeader } from "@/components/ui/display";
import { formatDate } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { listFeeds } from "@/lib/community/feeds";

export const metadata = { title: "Subscribe to the calendar" };

export default async function SubscribePage({ params }: PageProps<"/w/[workspaceSlug]/calendar/subscribe">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const feeds = await listFeeds(ctx);
  const tz = ctx.workspace.timezone;
  const since = (scope: "PERSONAL" | "CALENDAR") => {
    const at = feeds.get(scope);
    return at ? formatDate(at, tz) : null;
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link href={`/w/${ctx.workspace.slug}/calendar`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Calendar
      </Link>
      <PageHeader
        title="Subscribe in your calendar app"
        description="Private links for Google Calendar, Apple Calendar or Outlook. They update about once an hour. Treat a link like a password: anyone with it can read what it shows."
      />
      <FeedManager
        slug={ctx.workspace.slug}
        feeds={[
          { scope: "PERSONAL", title: "My calendar", description: "Events you replied to, your meetings, your rota shifts and the due dates of tasks assigned to you.", activeSince: since("PERSONAL") },
          { scope: "CALENDAR", title: `${ctx.workspace.name} community`, description: "Every build night, meetup and workshop on the community calendar.", activeSince: since("CALENDAR") },
        ]}
      />
    </div>
  );
}
