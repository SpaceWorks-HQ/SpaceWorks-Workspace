import type { DocVisibility, WorkspaceRole } from "@prisma/client";
import { hasRoleAtLeast } from "@/lib/roles";

/**
 * Pure doc rules shared by server code, client components and tests.
 *
 * Roles: GUEST reads WORKSPACE docs; MEMBER creates and edits them; ADMIN
 * also reads, edits and manages ADMINS-only docs. Invariant: a page under an
 * admin-only page is admin-only too, so a member's tree never has holes.
 */

type Holder = { role: WorkspaceRole } | null | undefined;

export function canSeeDoc(m: Holder, doc: { visibility: DocVisibility }) {
  if (!m) return false;
  return doc.visibility === "WORKSPACE" || hasRoleAtLeast(m.role, "ADMIN");
}

export function canCreateDocs(m: Holder) {
  return Boolean(m && hasRoleAtLeast(m.role, "MEMBER"));
}

export function canEditDoc(m: Holder, doc: { visibility: DocVisibility }) {
  return canCreateDocs(m) && canSeeDoc(m, doc);
}

/** Admin-only visibility is managed by admins. */
export function canManageDocVisibility(m: Holder) {
  return Boolean(m && hasRoleAtLeast(m.role, "ADMIN"));
}

/** Archive or restore: the doc's creator or an admin. */
export function canArchiveDoc(m: Holder, doc: { visibility: DocVisibility; createdById: string | null }, userId: string) {
  if (!canEditDoc(m, doc)) return false;
  return hasRoleAtLeast(m!.role, "ADMIN") || doc.createdById === userId;
}

// ───────────── Revisions ─────────────

/** Edits by the same person inside this window update their latest snapshot instead of adding one. */
export const REVISION_COALESCE_MS = 10 * 60_000;
export const MAX_DOC_TITLE = 200;

/**
 * Should a save add a new revision (true) or refresh the author's latest one
 * (false)? A "meaningful save" starts a new editing session: a different
 * author, a gap of 10+ minutes, or no revision yet.
 */
export function startsNewRevision(latest: { authorId: string | null; createdAt: Date } | null, authorId: string, now: Date) {
  if (!latest) return true;
  if (latest.authorId !== authorId) return true;
  return now.getTime() - latest.createdAt.getTime() >= REVISION_COALESCE_MS;
}

export function contentChanged(before: { title: string; contentHtml: string }, after: { title: string; contentHtml: string }) {
  return before.title !== after.title || before.contentHtml !== after.contentHtml;
}

// ───────────── Verification ("verified until") ─────────────

export const VERIFY_PERIOD_DAYS = [30, 90, 180, 365] as const;
export type VerifyPeriod = (typeof VERIFY_PERIOD_DAYS)[number];
/** Show "Review soon" this many days before the verification lapses. */
export const VERIFY_DUE_SOON_DAYS = 7;

export type VerificationState = "none" | "verified" | "due_soon" | "expired";

export function verificationState(verifiedUntil: Date | string | null | undefined, now: Date = new Date()): VerificationState {
  if (!verifiedUntil) return "none";
  const until = new Date(verifiedUntil).getTime();
  if (until <= now.getTime()) return "expired";
  if (until - now.getTime() <= VERIFY_DUE_SOON_DAYS * 86_400_000) return "due_soon";
  return "verified";
}

export function verifiedUntilFrom(now: Date, days: VerifyPeriod) {
  return new Date(now.getTime() + days * 86_400_000);
}
