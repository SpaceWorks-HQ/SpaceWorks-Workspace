import "server-only";

import {
  date,
  id,
  text,
  title,
} from "@/lib/meetings/core";
import { z } from "zod";

export const cycleCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    projectId: id,
    name: title,
    goal: text,
    startsAt: date,
    endsAt: date,
  }),
  z.object({
    op: z.literal("assign"),
    cycleId: id,
    taskId: id,
    remove: z.boolean().default(false),
  }),
  z.object({ op: z.literal("start"), cycleId: id }),
  z.object({
    op: z.literal("review"),
    cycleId: id,
    review: z.string().trim().min(1).max(20_000),
  }),
  z.object({
    op: z.literal("edit"),
    cycleId: id,
    name: title,
    goal: text,
    startsAt: date,
    endsAt: date,
  }),
  z.object({
    op: z.literal("complete"),
    cycleId: id,
    carryToId: z.preprocess((v) => (v === "" ? null : v), id.nullish()),
    review: text,
  }),
]);


export type CycleCommand = z.infer<typeof cycleCommand>;
