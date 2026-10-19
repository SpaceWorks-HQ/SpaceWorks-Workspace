import { notFound } from "next/navigation";
import { EventForm } from "@/components/community/EventForm";
import { PageHeader } from "@/components/ui/display";
import { formatTimeZoneName } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { safeTimeZone, zonedDatetimeLocalValue } from "@/lib/timeZone";
import { getEventDetail } from "@/lib/community/events";

export const metadata = { title: "Edit event" };

export default async function EditEventPage({ params }: PageProps<"/w/[workspaceSlug]/calendar/[eventId]/edit">) {
  const { workspaceSlug, eventId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const event = await getEventDetail(ctx, eventId);
  if (!event || !event.canEdit || event.cancelledAt) notFound();
  const tz = safeTimeZone(ctx.workspace.timezone);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Edit event" description="People who replied hear about changes to the time, place or name." />
      <EventForm
        slug={ctx.workspace.slug}
        eventId={event.id}
        initial={{
          title: event.title,
          kind: event.kind,
          startsAt: zonedDatetimeLocalValue(event.startsAt, tz),
          endsAt: event.endsAt ? zonedDatetimeLocalValue(event.endsAt, tz) : "",
          location: event.location ?? "",
          description: event.description ?? "",
          capacity: event.capacity === null ? "" : String(event.capacity),
        }}
        timeZoneLabel={`Times in ${formatTimeZoneName(event.startsAt, tz)} (${tz}).`}
      />
    </div>
  );
}
