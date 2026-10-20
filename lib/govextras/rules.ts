import { z } from "zod";
import { dateOnly } from "@/lib/governance/schemas";
export const caseKinds = ["SAFEGUARDING", "POSH"] as const;
export const caseStatuses = [
  "OPEN",
  "INVESTIGATING",
  "ACTION",
  "CLOSED",
] as const;
export const caseSchema = z
  .object({
    kind: z.enum(caseKinds),
    receivedOn: dateOnly,
    dueOn: dateOnly,
    handlerIds: z.array(z.string().min(1).max(64)).min(1).max(12),
    details: z.string().trim().min(1, "Record the concern.").max(20000),
  })
  .refine((v) => v.dueOn >= v.receivedOn, {
    message: "Choose a due date on or after receipt.",
    path: ["dueOn"],
  });
export const eventSchema = z
  .object({
    caseId: z.string().min(1).max(64),
    kind: z.enum(["NOTE", "ACTION", "OUTCOME"]),
    body: z.string().trim().min(1, "Add a note.").max(20000),
    ownerId: z.string().max(64).default(""),
    dueOn: z.union([dateOnly, z.literal("")]).default(""),
  })
  .refine((v) => v.kind !== "ACTION" || (v.ownerId && v.dueOn), {
    message: "Choose an action owner and due date.",
    path: ["dueOn"],
  });
export const appointmentSchema = z.object({
  userId: z.string().min(1).max(64),
  committeeId: z.string().min(1).max(64),
  endsOn: dateOnly,
  revoke: z.boolean().default(false),
});
export function riskScore(likelihood: number, impact: number) {
  if (
    ![likelihood, impact].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)
  )
    throw new Error("Choose likelihood and impact from 1 to 5.");
  const score = likelihood * impact;
  return { score, level: score >= 15 ? "High" : score >= 6 ? "Medium" : "Low" };
}
export function partyMatches(declared: string, payee: string) {
  const normal = (s: string) =>
    s.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  return Boolean(
    declared.trim() && payee.trim() && normal(declared) === normal(payee),
  );
}
export const linkSchema = z.object({
  declarationId: z.string().min(1).max(64),
  targetType: z.enum([
    "purchase",
    "bill",
    "contract",
    "decision",
    "resolution",
    "disbursement",
  ]),
  targetId: z.string().min(1).max(64),
  note: z.string().trim().max(2000).default(""),
});
