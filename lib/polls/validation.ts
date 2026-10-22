import "server-only";
import { z } from "zod";
import { id, optionalId, title, text, date } from "@/lib/meetings/core";

export const outcomeSchema = z.object({
  counts: z.record(z.string(), z.number()),
  ballots: z.number(),
  winners: z.array(z.string()),
  rounds: z.array(z.record(z.string(), z.number())),
  quorumMet: z.boolean(),
  eligibleCount: z.number(),
});
const eligibilitySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALL_MEMBERS") }),
  z.object({ type: z.literal("TEAM"), ref: id }),
  z.object({
    type: z.literal("ROLE"),
    ref: z.enum(["MEMBER", "ADMIN", "OWNER"]),
  }),
]);
const quorumSchema = z.union([
  z.object({ count: z.number().int().min(1).max(100_000) }),
  z.object({ percent: z.number().min(1).max(100) }),
]);
export const pollCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    question: title,
    descriptionMd: text,
    type: z.enum(["SINGLE", "MULTI", "RANKED"]),
    anonymous: z.boolean().default(false),
    resultsVisibility: z.enum(["LIVE", "AFTER_CLOSE"]),
    options: z.array(title).min(2).max(30),
    eligibility: eligibilitySchema.default({ type: "ALL_MEMBERS" }),
    quorum: quorumSchema.nullish(),
    closesAt: date,
    meetingId: optionalId,
  }),
  z.object({
    op: z.literal("vote"),
    pollId: id,
    choices: z.array(id).min(1).max(30),
  }),
  z.object({ op: z.literal("close"), pollId: id }),
]);
