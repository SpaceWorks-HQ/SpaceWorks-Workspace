import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import type { AttendanceStatus } from "@prisma/client";
import { KIND_TONES } from "@/components/community/CalendarViews";
import { CancelEventButton } from "@/components/community/CancelEventButton";
import { LiveRefresh } from "@/components/community/LiveRefresh";
import { RsvpControl } from "@/components/community/RsvpControl";
import { Button } from "@/components/ui/button";
import { Avatar, Callout, Card, CardHeader, Chip, DateBlock, DetailList, PageHeader } from "@/components/ui/display";
import { formatDateBlock, formatDayLong, formatRelativeDay, formatTimeRange } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canRsvp } from "@/lib/community/access";
import { getEventDetail } from "@/lib/community/events";
import { countAttendance, spotsLeft } from "@/lib/community/rsvp";
import { effectiveEnd } from "@/lib/community/schedule";
import { EVENT_KIND_LABELS } from "@/lib/community/validation";

export const metadata = { title: "Event" };

type Person = { userId: string; status: AttendanceStatus; user: { id: string; name: string | null; image: string | null } };

function PeopleList({ title, people, emptyText, numbered = false }: { title: string; people: Person[]; emptyText: string; numbered?: boolean }) {
  const List = numbered ? "ol" : "ul";
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-label text-ink">
        {title} <span className="font-normal tabular-nums text-ink-muted">{people.length}</span>
      </h3>
      {people.length === 0 ? (
        <p className="text-caption text-ink-muted">{emptyText}</p>
      ) : (
        <List className="flex flex-col gap-1.5">
          {people.map((person, index) => (
            <li key={person.userId} className="flex items-center gap-2.5 text-body-ui text-ink">
              {numbered ? <span className="w-5 text-right text-caption tabular-nums text-ink-muted">{index + 1}</span> : null}
              <Avatar name={person.user.name} src={person.user.image} size="xs" />
              <span className="min-w-0 truncate">{person.user.name ?? "A member"}</span>
            </li>
          ))}
        </List>
      )}
    </section>
  );
}

export default async function EventPage({ params }: PageProps<"/w/[workspaceSlug]/calendar/[eventId]">) {
  const { workspaceSlug, eventId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const event = await getEventDetail(ctx, eventId);
  if (!event) notFound();
  const tz = ctx.workspace.timezone;
  const now = new Date();
  const base = `/w/${ctx.workspace.slug}/calendar`;
  const counts = countAttendance(event.attendees);
  const left = spotsLeft(event.capacity, counts.GOING);
  const started = event.startsAt.getTime() <= now.getTime();
  const block = formatDateBlock(event.startsAt, tz);
  const replied = counts.GOING + counts.MAYBE + counts.WAITLIST;
  const byStatus = (status: AttendanceStatus) => event.attendees.filter((attendee) => attendee.status === status);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <LiveRefresh slug={ctx.workspace.slug} types={["community.event.changed"]} eventId={event.id} />
      <Link href={`${base}?view=list`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Calendar
      </Link>
      <div className="flex gap-4">
        <DateBlock month={block.month} day={block.day} size="lg" tone={event.cancelledAt ? "draft" : "accent"} className="self-start" />
        <PageHeader
          className="min-w-0 flex-1"
          kicker={
            <span className="flex flex-wrap items-center gap-2">
              <Chip tone={KIND_TONES[event.kind]} size="sm">{EVENT_KIND_LABELS[event.kind]}</Chip>
              {event.cancelledAt ? <Chip tone="danger" size="sm">Cancelled</Chip> : started ? <Chip tone="outline" size="sm">Started</Chip> : <Chip tone="neutral" size="sm">{formatRelativeDay(event.startsAt, tz, now)}</Chip>}
            </span>
          }
          title={event.title}
          actions={
            <>
              <Button asChild variant="secondary">
                <a href={`${base}/${event.id}/ics`} download>
                  <CalendarPlus aria-hidden className="size-[18px]" />
                  Add to calendar
                </a>
              </Button>
              {event.canEdit && !event.cancelledAt ? (
                <Button asChild variant="secondary">
                  <Link href={`${base}/${event.id}/edit`}>Edit</Link>
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      {event.cancelledAt ? <Callout tone="warning" title="This event was cancelled.">Replies are closed. Check the calendar for the next one.</Callout> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex flex-col gap-5">
          <DetailList
            items={[
              { label: "When", value: <span className="tabular-nums">{formatDayLong(event.startsAt, tz, now)}, {formatTimeRange(event.startsAt, effectiveEnd(event.startsAt, event.endsAt), tz)}</span> },
              ...(event.location ? [{ label: "Where", value: event.location }] : []),
              { label: "Organiser", value: event.createdBy?.name ?? "Former member" },
              {
                label: "Spots",
                value: event.capacity === null ? "No limit" : <span className="tabular-nums">{counts.GOING} of {event.capacity} taken{left === 0 ? " · waitlist open" : ` · ${left} left`}</span>,
              },
            ]}
          />
          {event.description ? <p className="whitespace-pre-line break-words border-t border-line pt-5 text-body-ui text-ink-secondary">{event.description}</p> : null}
        </Card>

        <div className="flex flex-col gap-6">
          {!event.cancelledAt && !started && canRsvp(ctx.membership) ? (
            <Card>
              <CardHeader title="Are you coming?" titleAs="h2" />
              <RsvpControl
                key={`${event.myStatus}-${event.myWaitlistPosition}`}
                slug={ctx.workspace.slug}
                eventId={event.id}
                status={event.myStatus}
                position={event.myWaitlistPosition}
                full={left === 0}
              />
            </Card>
          ) : null}
          <Card className="flex flex-col gap-5">
            <h2 className="text-title text-ink">Who&apos;s coming</h2>
            {replied === 0 ? <p className="text-body-ui text-ink-muted">No replies yet.</p> : null}
            <PeopleList title="Going" people={byStatus("GOING")} emptyText="Nobody yet." />
            {counts.MAYBE > 0 ? <PeopleList title="Maybe" people={byStatus("MAYBE")} emptyText="" /> : null}
            {counts.WAITLIST > 0 ? <PeopleList title="Waitlist" people={byStatus("WAITLIST")} emptyText="" numbered /> : null}
          </Card>
          {event.canEdit && !event.cancelledAt ? (
            <div className="flex justify-end">
              <CancelEventButton slug={ctx.workspace.slug} eventId={event.id} title={event.title} attendees={replied} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
