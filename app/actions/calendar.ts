"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { collaborationAction } from "@/lib/meetings/action";
import {
  saveMeeting,
  cancelMeeting,
  moveTaskDue,
  saveEntry,
  deleteEntry,
} from "@/lib/calendar/service";
import { availabilityFor } from "@/lib/calendar/availability";
import { syncGoogle } from "@/lib/calendar/google";
import { attachCalendarFile } from "@/lib/calendar/files";
import { beginGoogle } from "@/lib/integrations/google/oauth";
import { mutateMeeting } from "@/lib/meetings/service";

export async function scheduleMeetingAction(slug: string, input: unknown) {
  const result = await collaborationAction(slug, "calendar", (a) =>
    saveMeeting(a, input),
  );
  if (result.ok) revalidatePath(`/w/${slug}/meetings`);
  return result;
}
export async function cancelCalendarMeetingAction(slug: string, id: string) {
  return collaborationAction(slug, "calendar", async (a) => {
    await cancelMeeting(a, z.string().min(1).max(100).parse(id));
    revalidatePath(`/w/${slug}/meetings`);
  });
}
export async function calendarRsvpAction(
  slug: string,
  id: string,
  rsvp: string,
) {
  return collaborationAction(
    slug,
    "calendar",
    (a) => mutateMeeting(a, { op: "rsvp", meetingId: id, rsvp }),
    true,
  );
}
export async function moveCalendarTaskAction(slug: string, input: unknown) {
  return collaborationAction(slug, "calendar", (a) => moveTaskDue(a, input));
}
export async function saveCalendarEntryAction(slug: string, input: unknown) {
  return collaborationAction(
    slug,
    "calendar",
    (a) => saveEntry(a, input),
    true,
  );
}
export async function deleteCalendarEntryAction(slug: string, id: string) {
  return collaborationAction(
    slug,
    "calendar",
    (a) => deleteEntry(a, z.string().min(1).max(100).parse(id)),
    true,
  );
}
export async function calendarAvailabilityAction(slug: string, input: unknown) {
  return collaborationAction(slug, "calendar", (a) =>
    availabilityFor(a, input),
  );
}
export async function syncCalendarGoogleAction(
  slug: string,
  createMeetId?: string,
) {
  return collaborationAction(slug, "calendar", (a) =>
    syncGoogle(
      a,
      createMeetId ? z.string().max(100).parse(createMeetId) : undefined,
    ),
  );
}
export async function connectCalendarGoogleAction(slug: string) {
  return collaborationAction(slug, "calendar", (a) =>
    beginGoogle(a.workspace.id, a.user.id, slug, true),
  );
}
export async function attachCalendarFileAction(
  slug: string,
  id: string,
  form: FormData,
) {
  return collaborationAction(
    slug,
    "calendar",
    (a) => {
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Choose a file.");
      return attachCalendarFile(a, z.string().max(100).parse(id), file);
    },
    true,
  );
}
