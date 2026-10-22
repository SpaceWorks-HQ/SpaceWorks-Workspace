import "server-only";
import { z } from "zod";
import { id, optionalId, title, text, date } from "../core";

export const meetingCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    title,
    startsAt: date,
    endsAt: date,
    location: z.string().trim().max(500).default(""),
    teamId: optionalId,
    visibility: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("WORKSPACE"),
    facilitatorId: optionalId,
    attendeeIds: z.array(id).max(200).default([]),
    repeat: z
      .enum(["NONE", "WEEKLY", "FORTNIGHTLY", "MONTHLY"])
      .default("NONE"),
    occurrences: z.coerce.number().int().min(1).max(24).default(1),
    templateId: optionalId,
  }),
  z.object({
    op: z.literal("details"),
    meetingId: id,
    title,
    startsAt: date,
    endsAt: date,
    location: z.string().trim().max(500).default(""),
    notesDocId: optionalId,
    status: z.enum(["SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED"]),
  }),
  z.object({
    op: z.literal("agenda"),
    meetingId: id,
    title,
    ownerId: optionalId,
    durationMin: z.coerce.number().int().min(1).max(480).default(10),
    notesMd: text,
  }),
  z.object({
    op: z.literal("agendaUpdate"),
    meetingId: id,
    agendaId: id,
    title,
    ownerId: optionalId,
    durationMin: z.coerce.number().int().min(1).max(480),
    notesMd: text,
    status: z.enum(["OPEN", "DISCUSSED", "CARRIED_OVER"]),
  }),
  z.object({
    op: z.literal("reorder"),
    meetingId: id,
    agendaIds: z.array(id).max(200),
  }),
  z.object({
    op: z.literal("decision"),
    meetingId: id,
    title,
    contextMd: text,
    decisionMd: z.string().trim().min(1).max(20_000),
    ownerId: optionalId,
  }),
  z.object({
    op: z.literal("action"),
    meetingId: id,
    title,
    assigneeId: optionalId,
    projectId: optionalId,
    dueAt: z.preprocess((v) => (v === "" ? null : v), date.nullish()),
    requestId: id,
  }),
  z.object({ op: z.literal("attendee"), meetingId: id, userId: id }),
  z.object({
    op: z.literal("rsvp"),
    meetingId: id,
    rsvp: z.enum(["YES", "NO", "MAYBE"]),
  }),
  z.object({
    op: z.literal("attendance"),
    meetingId: id,
    userId: id,
    attended: z.boolean(),
  }),
  z.object({
    op: z.literal("publish"),
    meetingId: id,
    destinationIds: z.array(id).max(50).default([]),
  }),
]);
