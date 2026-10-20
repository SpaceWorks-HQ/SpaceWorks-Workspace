import { escapeText, foldLine, formatUtc } from "@/lib/community/ics";
export function meetingInvitation(input: {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  sequence: number;
  cancelled: boolean;
  location?: string | null;
  videoUrl?: string | null;
  organizer: string;
  attendee: string;
  now?: Date;
}) {
  const method = input.cancelled ? "CANCEL" : "REQUEST";
  const mail = (value: string) => value.replace(/[\r\n;,:]/g, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Space Works//Space Works Workspace//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:meeting-${input.id}@spaceworks-workspace`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${formatUtc(input.now ?? new Date())}`,
    `DTSTART:${formatUtc(input.startsAt)}`,
    `DTEND:${formatUtc(input.endsAt)}`,
    `SUMMARY:${escapeText(input.title)}`,
    `LOCATION:${escapeText(input.location ?? "")}`,
    `DESCRIPTION:${escapeText(input.videoUrl ?? "Space Works team meeting")}`,
    `ORGANIZER:mailto:${mail(input.organizer)}`,
    `ATTENDEE;RSVP=TRUE:mailto:${mail(input.attendee)}`,
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldLine)
    .join("\r\n");
}
