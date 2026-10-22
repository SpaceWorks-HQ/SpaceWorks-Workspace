import { z } from "zod";
import { idSchema } from "@/lib/validation";

/** Input schemas for the community actions (client-safe). Times arrive as datetime-local strings in the workspace zone. */

const localDateTime = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time.");
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

export const FEED_SCOPES = ["PERSONAL"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];
export const feedScopeSchema = z.object({ scope: z.enum(FEED_SCOPES) });

export const idInputSchema = z.object({ id: idSchema });
export const pinInputSchema = z.object({ id: idSchema, pinned: z.boolean() });
