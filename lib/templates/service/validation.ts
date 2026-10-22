import "server-only";
import { z } from "zod";
import {
  id,
  optionalId,
  title,
  text,
} from "@/lib/meetings/core";

export const templateCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    name: title,
    description: text,
    kind: z.enum(["DOC", "PROJECT", "TASK", "MEETING"]),
    title,
    text,
    teamId: optionalId,
    scope: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("WORKSPACE"),
  }),
  z.object({
    op: z.literal("apply"),
    templateId: id,
    key: z.string().trim().max(10).optional(),
    projectId: optionalId,
    requestId: id,
  }),
  z.object({ op: z.literal("delete"), templateId: id }),
  z.object({
    op: z.literal("edit"),
    templateId: id,
    name: title,
    description: text,
    title,
    text,
  }),
]);
