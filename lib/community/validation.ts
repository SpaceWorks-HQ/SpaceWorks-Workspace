import { z } from "zod";
import { idSchema } from "@/lib/validation";

/** Input schemas for the community actions (client-safe). Times arrive as datetime-local strings in the workspace zone. */

const localDateTime = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time.");
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : null));

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the announcement a title.").max(140, "Keep the title under 140 characters."),
    body: z.string().max(100_000, "That announcement is too long. Trim it a little."),
    pinned: z.boolean().default(false),
    publish: z.enum(["now", "schedule", "draft"]),
    scheduledFor: z.string().trim().optional(),
    destinationIds: z.array(idSchema).max(20, "Pick up to 20 destinations.").default([]),
  })
  .superRefine((value, ctx) => {
    if (value.publish === "schedule" && !localDateTime.safeParse(value.scheduledFor ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["scheduledFor"], message: "Pick when it should go out." });
    }
  });
export type AnnouncementInput = z.input<typeof announcementInputSchema>;

export const EVENT_KINDS = ["BUILD_NIGHT", "MEETUP", "WORKSHOP", "OTHER"] as const;
export const EVENT_KIND_LABELS: Record<(typeof EVENT_KINDS)[number], string> = {
  BUILD_NIGHT: "Build night",
  MEETUP: "Meetup",
  WORKSHOP: "Workshop",
  OTHER: "Other",
};

export const eventInputSchema = z.object({
  title: z.string().trim().min(1, "Give the event a name.").max(120, "Keep the name under 120 characters."),
  kind: z.enum(EVENT_KINDS),
  startsAt: localDateTime,
  endsAt: z.union([localDateTime, z.literal("")]).optional(),
  location: optionalText(200, "Keep the location under 200 characters."),
  description: optionalText(4000, "Keep the description under 4,000 characters."),
  capacity: z
    .union([z.number().int("Use a whole number of spots.").min(1, "Allow at least one spot.").max(10_000, "That is more spots than we can track."), z.null()])
    .default(null),
});
export type EventInput = z.input<typeof eventInputSchema>;

export const rsvpInputSchema = z.object({
  eventId: idSchema,
  status: z.enum(["GOING", "MAYBE", "NOT_GOING"]),
});

export const shoutoutInputSchema = z.object({
  toId: idSchema,
  message: z.string().trim().min(1, "Say what they did.").max(500, "Keep it under 500 characters."),
});

export const FEED_SCOPES = ["PERSONAL", "CALENDAR"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];
export const feedScopeSchema = z.object({ scope: z.enum(FEED_SCOPES) });

export const idInputSchema = z.object({ id: idSchema });
export const pinInputSchema = z.object({ id: idSchema, pinned: z.boolean() });
