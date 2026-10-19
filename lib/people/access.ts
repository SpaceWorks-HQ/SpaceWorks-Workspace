import type { TeamRole, TeamVisibility, Visibility } from "@prisma/client";
import { canManageMembers, canManageOnboarding, canManageTeams, canViewEmergencyContact, hasRoleAtLeast, type RoleHolder } from "@/lib/roles";

/**
 * People and teams capability rules (pure and client-safe). Server code
 * checks these after resolving the membership from the database; hiding a
 * button is never the authorization. Role gates come from `lib/roles.ts`;
 * the record-level rules (self, team lead, private team) live here.
 */

const atLeast = (m: RoleHolder, min: "GUEST" | "MEMBER" | "ADMIN") => m != null && hasRoleAtLeast(m.role, min);

/* ───────────── Profiles ───────────── */

/** Members edit their own workspace profile (skills, handles, emergency contact). */
export const canEditOwnProfile = (m: RoleHolder) => atLeast(m, "GUEST");

/** Admin-only profile fields: community title, membership type, keyholder flag, leaving date. */
export const canEditAdminProfileFields = (m: RoleHolder) => canManageMembers(m);

/** Emergency contact: admins and the member themselves (every view is audited). */
export const canSeeEmergencyContact = (m: RoleHolder, isSelf: boolean) => canViewEmergencyContact(m, isSelf);

/** Emergency contact is written only by the member themselves (admins read it, never set it). */
export const canSetEmergencyContact = (m: RoleHolder, isSelf: boolean) => isSelf && atLeast(m, "GUEST");

/** Email addresses in the directory: members and above (guests see names and roles). */
export const canSeeMemberEmails = (m: RoleHolder) => atLeast(m, "MEMBER");

/* ───────────── Availability ───────────── */

/** Add or remove away periods: yourself, or an admin for anyone. */
export function canManageAvailabilityFor(m: RoleHolder, isSelf: boolean) {
  if (isSelf) return atLeast(m, "GUEST");
  return atLeast(m, "ADMIN");
}

/**
 * Can the viewer see an availability row? WORKSPACE: everyone. TEAM: people
 * sharing a team with its owner (and admins). PRIVATE: the owner and admins.
 */
export function canSeeAvailability(
  viewer: { role: RoleHolder; userId: string; teamIds: ReadonlySet<string> | readonly string[] },
  row: { userId: string; visibility: Visibility; ownerTeamIds: readonly string[] },
) {
  if (row.userId === viewer.userId || atLeast(viewer.role, "ADMIN")) return true;
  if (row.visibility === "WORKSPACE") return true;
  if (row.visibility === "PRIVATE") return false;
  const mine = viewer.teamIds instanceof Set ? viewer.teamIds : new Set(viewer.teamIds as readonly string[]);
  return row.ownerTeamIds.some((id) => mine.has(id));
}

/* ───────────── Teams ───────────── */

/** See a team at all: public teams for everyone; private teams for their members and admins. */
export function canSeeTeam(m: RoleHolder, team: { visibility: TeamVisibility }, isTeamMember: boolean) {
  if (team.visibility === "PUBLIC") return atLeast(m, "GUEST");
  return isTeamMember || atLeast(m, "ADMIN");
}

/** Create, rename, archive teams and change visibility. */
export const canAdministerTeams = (m: RoleHolder) => canManageTeams(m);

/** Add/remove members and change team roles: admins, and the team's own leads. */
export function canManageTeamMembers(m: RoleHolder, myTeamRole: TeamRole | null) {
  return canManageTeams(m) || (myTeamRole === "LEAD" && atLeast(m, "MEMBER"));
}

/** Join or leave a public team yourself. Guests watch from the side. */
export function canJoinTeam(m: RoleHolder, team: { visibility: TeamVisibility; archivedAt: Date | null }) {
  return team.visibility === "PUBLIC" && team.archivedAt === null && atLeast(m, "MEMBER");
}

/* ───────────── Onboarding ───────────── */

/** Templates and starting runs for other people. */
export const canManageChecklists = (m: RoleHolder) => canManageOnboarding(m);

/**
 * Tick an item: its assignee, the run's subject (for items assigned to them
 * or unassigned), or an admin.
 */
export function canTickChecklistItem(m: RoleHolder, userId: string, item: { assigneeId: string | null }, run: { subjectUserId: string | null }) {
  if (canManageOnboarding(m)) return true;
  if (item.assigneeId === userId) return true;
  return item.assigneeId === null && run.subjectUserId === userId;
}

/** See a run: its subject, anyone with an item on it, or an admin. */
export function canSeeChecklistRun(m: RoleHolder, userId: string, run: { subjectUserId: string | null }, assigneeIds: readonly string[]) {
  if (canManageOnboarding(m)) return true;
  return run.subjectUserId === userId || assigneeIds.includes(userId);
}
