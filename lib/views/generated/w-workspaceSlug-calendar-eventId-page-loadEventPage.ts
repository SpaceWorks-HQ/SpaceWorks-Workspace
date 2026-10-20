// Generated from app/w/[workspaceSlug]/calendar/[eventId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import type { AttendanceStatus } from "@prisma/client";
import { formatDateBlock } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { getEventDetail } from "@/lib/community/events";
import { countAttendance, spotsLeft } from "@/lib/community/rsvp";
type Person = { userId: string; status: AttendanceStatus; user: { id: string; name: string | null; image: string | null } };
export async function loadEventPage({ params }: PageProps<"/w/[workspaceSlug]/calendar/[eventId]">) {
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
return viewDto({ ctx, event, tz, now, base, counts, left, started, block, replied } as const);
}
