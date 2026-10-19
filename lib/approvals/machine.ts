import { z } from "zod";

/**
 * Pure approval rules (client-safe, unit-tested): the step format stored in
 * `ApprovalPolicy.steps` / `ApprovalRequest.steps`, which steps apply to an
 * amount, who may decide, and how a decision moves the request.
 *
 * Steps run in order. A step completes when `minApprovals` eligible people
 * approved it. An unavailable approver never reduces the required quorum. Any rejection
 * ends the request as REJECTED; "request changes" sends it back to the
 * requester (CHANGES_REQUESTED) and a resubmission starts again at step 0.
 */

export const APPROVER_TYPES = ["ROLE", "TEAM_LEAD", "USER", "TEAM"] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
export type ApprovalDecisionValue = (typeof APPROVAL_DECISIONS)[number];

export type ApprovalState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "CHANGES_REQUESTED";

/** `TEAM_LEAD` with ref `"*"` means the leads of any team the requester belongs to. */
export const REQUESTER_TEAMS = "*";

const idRef = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_*-]+$/, "Pick who approves this step.");

export const approvalStepSchema = z
  .object({
    approverType: z.enum(APPROVER_TYPES),
    ref: idRef,
    minApprovals: z.coerce.number().int().min(1, "At least one approval.").max(10, "At most 10 approvals per step.").default(1),
    /** The step only applies when the amount is at least this (minor units). */
    minAmountMinor: z.coerce.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
    label: z.string().trim().max(60).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.approverType === "ROLE" && !["OWNER", "ADMIN", "MEMBER"].includes(step.ref)) {
      ctx.addIssue({ code: "custom", path: ["ref"], message: "Role steps need Owner, Admin or Member." });
    }
    if (step.ref === REQUESTER_TEAMS && step.approverType !== "TEAM_LEAD") {
      ctx.addIssue({ code: "custom", path: ["ref"], message: "Only team-lead steps can use the requester's team." });
    }
  });

export type ApprovalStep = z.infer<typeof approvalStepSchema>;

export const approvalStepsSchema = z.array(approvalStepSchema).min(1, "Add at least one step.").max(6, "Keep it to six steps or fewer.");

/** Used when a subject type has no policy: one approval from any admin or owner. */
export const DEFAULT_STEPS: ApprovalStep[] = [{ approverType: "ROLE", ref: "ADMIN", minApprovals: 1 }];

/** Parse stored JSON, falling back to the default chain if it is unreadable. */
export function parseSteps(value: unknown): ApprovalStep[] {
  const parsed = approvalStepsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_STEPS;
}

/** Steps that apply to an amount (amount-less subjects skip steps with a threshold). */
export function applicableSteps(steps: ApprovalStep[], amountMinor: number | null | undefined): ApprovalStep[] {
  return steps.filter((step) => step.minAmountMinor == null || (amountMinor != null && amountMinor >= step.minAmountMinor));
}

/** Approvals a step needs given how many people can approve it. */
export function requiredApprovals(step: ApprovalStep, eligibleCount: number): number {
  void eligibleCount;
  return step.minApprovals;
}

/** Why `actorId` may not decide right now, or null when they may. */
export function decisionBlocker(input: {
  status: ApprovalState;
  actorId: string;
  requesterId: string;
  eligible: ReadonlySet<string>;
  alreadyDecided: boolean;
}): string | null {
  if (input.status !== "PENDING") return "This request has already been decided.";
  if (input.actorId === input.requesterId) return "You can't approve your own request.";
  if (!input.eligible.has(input.actorId)) return "You're not an approver for this step.";
  if (input.alreadyDecided) return "You've already decided this step.";
  return null;
}

export type Transition = {
  status: ApprovalState;
  currentStep: number;
  /** The request reached APPROVED or REJECTED. */
  final: boolean;
  /** Moved on to a later step (notify that step's approvers). */
  advanced: boolean;
};

/**
 * Apply one decision. `approvalsAtStep` counts APPROVED decisions on the
 * current step including this one; `required` comes from `requiredApprovals`.
 */
export function transition(input: {
  currentStep: number;
  stepCount: number;
  decision: ApprovalDecisionValue;
  approvalsAtStep: number;
  required: number;
}): Transition {
  if (input.decision === "REJECTED") return { status: "REJECTED", currentStep: input.currentStep, final: true, advanced: false };
  if (input.decision === "CHANGES_REQUESTED") return { status: "CHANGES_REQUESTED", currentStep: input.currentStep, final: false, advanced: false };
  if (input.approvalsAtStep < input.required) return { status: "PENDING", currentStep: input.currentStep, final: false, advanced: false };
  const next = input.currentStep + 1;
  if (next >= input.stepCount) return { status: "APPROVED", currentStep: input.currentStep, final: true, advanced: false };
  return { status: "PENDING", currentStep: next, final: false, advanced: true };
}

export function describeStep(step: ApprovalStep, names: { users?: Map<string, string>; teams?: Map<string, string> } = {}): string {
  const many = step.minApprovals > 1 ? `${step.minApprovals} × ` : "";
  const threshold = step.minAmountMinor != null ? " (above the threshold)" : "";
  switch (step.approverType) {
    case "ROLE":
      return `${many}${step.ref === "OWNER" ? "an owner" : step.ref === "ADMIN" ? "an admin" : "any member"}${threshold}`;
    case "USER":
      return `${many}${names.users?.get(step.ref) ?? "a named member"}${threshold}`;
    case "TEAM":
      return `${many}someone in ${names.teams?.get(step.ref) ?? "a team"}${threshold}`;
    case "TEAM_LEAD":
      return `${many}${step.ref === REQUESTER_TEAMS ? "the requester's team lead" : `the lead of ${names.teams?.get(step.ref) ?? "a team"}`}${threshold}`;
  }
}

export function approvalStatusLabel(status: ApprovalState): string {
  return { PENDING: "Pending approval", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled", CHANGES_REQUESTED: "Changes requested" }[status];
}
