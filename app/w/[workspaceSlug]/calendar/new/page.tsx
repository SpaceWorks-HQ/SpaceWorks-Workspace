import { EventForm } from "@/components/community/EventForm";
import { PageHeader } from "@/components/ui/display";
import { formatTimeZoneName } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { safeTimeZone } from "@/lib/timeZone";
import { dayKey, parseDayKey } from "@/lib/community/schedule";

export const metadata = { title: "New event" };

export default async function NewEventPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/calendar/new">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const query = await searchParams;
  const tz = safeTimeZone(ctx.workspace.timezone);
  const now = new Date();
  // Default: the chosen day (or today) at 6 PM, the usual build-night start.
  const today = dayKey(now, tz);
  const picked = parseDayKey(query.date);
  const day = picked && picked >= today ? picked : today;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="New event" description="Put a build night, meetup or workshop on the calendar. The crew can reply going, maybe or not going." />
      <EventForm
        slug={ctx.workspace.slug}
        eventId={null}
        initial={{ title: "", kind: "BUILD_NIGHT", startsAt: `${day}T18:00`, endsAt: `${day}T21:00`, location: "", description: "", capacity: "" }}
        timeZoneLabel={`Times in ${formatTimeZoneName(now, tz)} (${tz}).`}
      />
    </div>
  );
}
