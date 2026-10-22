import "server-only";
import { z } from "zod";
import { id, optionalId, title, text, date } from "@/lib/meetings/core";

export const goalCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    title,
    description: text,
    ownerId: optionalId,
    teamId: optionalId,
    parentGoalId: optionalId,
    periodStart: date,
    periodEnd: date,
  }),
  z.object({
    op: z.literal("result"),
    goalId: id,
    title,
    metricType: z.enum(["NUMBER", "PERCENT", "BOOLEAN"]),
    start: z.coerce.number().finite(),
    target: z.coerce.number().finite(),
  }),
  z.object({
    op: z.literal("checkin"),
    goalId: id,
    resultId: id,
    value: z.coerce.number().finite(),
    note: text,
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  }),
  z.object({
    op: z.literal("status"),
    goalId: id,
    status: z.enum(["ON_TRACK", "AT_RISK", "OFF_TRACK", "DONE"]),
  }),
  z.object({
    op: z.literal("edit"),
    goalId: id,
    title,
    description: text,
    ownerId: id,
    periodStart: date,
    periodEnd: date,
  }),
  z.object({
    op: z.literal("link"),
    goalId: id,
    type: z.enum(["task", "project"]),
    targetId: id,
  }),
]);

