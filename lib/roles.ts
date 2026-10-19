import type { WorkspaceRole } from "@prisma/client";

/**
 * Pure role and capability rules (safe to import in client components and
 * unit tests). Server code checks these after `requireWorkspace` resolved the
 * membership from the database; UI visibility is never authorization.
 *
 * OWNER > ADMIN > MEMBER > GUEST.
 */
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const;

const roleRank: Record<WorkspaceRole, number> = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function hasRoleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return roleRank[role] >= roleRank[min];
}

export function roleLabel(role: WorkspaceRole): string {
  return { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", GUEST: "Guest" }[role];
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** Minimal shape the capability helpers need (a Membership row or a DTO). */
export type RoleHolder = { role: WorkspaceRole } | null | undefined;
type FinanceWorkspace = { financeVisibleToMembers: boolean };

const atLeast = (m: RoleHolder, min: WorkspaceRole) => m != null && hasRoleAtLeast(m.role, min);

/** Create and edit tasks, docs, files, messages, shoutouts. */
export const canContribute = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Invite, change roles, suspend and remove members. */
export const canManageMembers = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageLabels = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageChannels = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageFinance = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageBlog = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageApiTokens = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageIntegrations = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canViewAuditLog = (m: RoleHolder) => atLeast(m, "ADMIN");
/** General workspace settings (name, timezone, currency, feature toggles). */
export const canManageWorkspace = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Delete the workspace or transfer ownership. */
export const canDeleteWorkspace = (m: RoleHolder) => atLeast(m, "OWNER");
export const canTransferOwnership = (m: RoleHolder) => atLeast(m, "OWNER");

/** Admins always see the kitty; members only when the workspace allows it; guests never. */
export function canViewFinance(m: RoleHolder, workspace: FinanceWorkspace): boolean {
  if (atLeast(m, "ADMIN")) return true;
  return atLeast(m, "MEMBER") && workspace.financeVisibleToMembers;
}

/**
 * Which roles an actor may assign. Only owners create owners or admins;
 * admins may move people between MEMBER and GUEST.
 */
export function assignableRoles(actor: RoleHolder): WorkspaceRole[] {
  if (atLeast(actor, "OWNER")) return ["OWNER", "ADMIN", "MEMBER", "GUEST"];
  if (atLeast(actor, "ADMIN")) return ["MEMBER", "GUEST"];
  return [];
}

/** Can `actor` change or remove a member who currently has `targetRole`? */
export function canActOnMember(actor: RoleHolder, targetRole: WorkspaceRole): boolean {
  if (!canManageMembers(actor)) return false;
  if (actor!.role === "OWNER") return true;
  // Admins manage members and guests, never other admins or owners.
  return targetRole === "MEMBER" || targetRole === "GUEST";
}
