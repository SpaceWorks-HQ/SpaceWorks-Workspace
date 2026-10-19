import type { AttendanceStatus } from "@prisma/client";

/**
 * RSVP rules (pure). A capped event fills up with GOING responses; later
 * "going" replies join the WAITLIST in the order they arrived, and freed
 * spots go to the longest-waiting person first. Lowering the capacity never
 * bumps anyone who is already going.
 */

export type RsvpChoice = "GOING" | "MAYBE" | "NOT_GOING";
export const RSVP_CHOICES: readonly RsvpChoice[] = ["GOING", "MAYBE", "NOT_GOING"] as const;

export type AttendeeState = { userId: string; status: AttendanceStatus; respondedAt: Date };

function byArrival(a: AttendeeState, b: AttendeeState) {
  const diff = a.respondedAt.getTime() - b.respondedAt.getTime();
  return diff !== 0 ? diff : a.userId.localeCompare(b.userId);
}

export function countAttendance(attendees: readonly AttendeeState[]) {
  const counts = { GOING: 0, MAYBE: 0, NOT_GOING: 0, WAITLIST: 0 } satisfies Record<AttendanceStatus, number>;
  for (const attendee of attendees) counts[attendee.status] += 1;
  return counts;
}

/** Spots left, or null when the event has no cap. Never negative. */
export function spotsLeft(capacity: number | null, going: number): number | null {
  if (capacity === null) return null;
  return Math.max(0, capacity - going);
}

/**
 * The status to store when `userId` answers `requested`. `attendees` is the
 * event's current list (it may include the user's earlier answer).
 */
export function resolveRsvp(input: { userId: string; requested: RsvpChoice; capacity: number | null; attendees: readonly AttendeeState[] }): AttendanceStatus {
  const { userId, requested, capacity, attendees } = input;
  if (requested !== "GOING") return requested;
  const current = attendees.find((attendee) => attendee.userId === userId) ?? null;
  if (current?.status === "GOING") return "GOING";
  if (capacity === null) return "GOING";
  const others = attendees.filter((attendee) => attendee.userId !== userId);
  const going = others.filter((attendee) => attendee.status === "GOING").length;
  // Nobody jumps the queue: someone already waiting gets a freed spot first.
  const waitingAhead =
    current?.status === "WAITLIST"
      ? others.filter((attendee) => attendee.status === "WAITLIST" && byArrival(attendee, current) < 0).length
      : others.filter((attendee) => attendee.status === "WAITLIST").length;
  return going < capacity && waitingAhead === 0 ? "GOING" : "WAITLIST";
}

/** Waitlisted user ids that should move to GOING, longest-waiting first. */
export function promotionsFor(capacity: number | null, attendees: readonly AttendeeState[]): string[] {
  const waiting = attendees.filter((attendee) => attendee.status === "WAITLIST").sort(byArrival);
  if (capacity === null) return waiting.map((attendee) => attendee.userId);
  const free = spotsLeft(capacity, attendees.filter((attendee) => attendee.status === "GOING").length) ?? 0;
  return waiting.slice(0, free).map((attendee) => attendee.userId);
}

/** 1-based place in the waitlist, or null when the user is not waiting. */
export function waitlistPosition(attendees: readonly AttendeeState[], userId: string): number | null {
  const waiting = attendees.filter((attendee) => attendee.status === "WAITLIST").sort(byArrival);
  const index = waiting.findIndex((attendee) => attendee.userId === userId);
  return index === -1 ? null : index + 1;
}

export function attendanceLabel(status: AttendanceStatus): string {
  return { GOING: "Going", MAYBE: "Maybe", NOT_GOING: "Not going", WAITLIST: "Waitlist" }[status];
}
