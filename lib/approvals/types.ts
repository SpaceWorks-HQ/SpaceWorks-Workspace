import type { ApprovalSubjectType, Prisma } from "@prisma/client";

/**
 * Per-subject hooks for the approvals engine. Each subject type that goes
 * through approvals registers one in `lib/approvals/registry.ts`. Hook
 * modules must not import `lib/approvals/engine.ts` (the engine imports the
 * registry), only these types.
 */
export type ApprovalOutcome = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "CANCELLED";

export type ApprovalHookContext = {
  workspaceId: string;
  workspaceSlug: string;
  request: {
    id: string;
    subjectType: ApprovalSubjectType;
    subjectId: string;
    title: string;
    requesterId: string;
    amountMinor: number | null;
    currency: string | null;
  };
  outcome: ApprovalOutcome;
  /** Who decided (null when the engine auto-approved an empty chain). */
  actorId: string | null;
  comment: string | null;
  now: Date;
};

export type ApprovalHook = {
  /** Optional live source gate for private subjects, used by reads, decisions and notifications. */
  canRead?(client: Prisma.TransactionClient, workspaceId: string, subjectId: string, userId: string): Promise<boolean>;
  /** App-relative link to the subject, used in notifications and the inbox. */
  url(workspaceSlug: string, subjectId: string): string;
  /** Noun for copy ("purchase request"). */
  noun: string;
  /**
   * Runs inside the decision transaction when the request is APPROVED,
   * REJECTED, sent back (CHANGES_REQUESTED) or CANCELLED. Update the subject
   * row here (status, grants…). Throwing rolls the decision back.
   */
  onDecided?(tx: Prisma.TransactionClient, ctx: ApprovalHookContext): Promise<void>;
};
