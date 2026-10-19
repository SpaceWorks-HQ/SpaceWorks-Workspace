import { hasRoleAtLeast, type RoleHolder } from "@/lib/roles";

/**
 * Community capability rules (pure and client-safe). Server code checks
 * these after resolving the membership from the database; hiding a button is
 * never the authorization.
 *
 * - Announcements: admins write, pin and schedule. The schema has no
 *   workspace switch for member-written announcements yet, so members read.
 * - Events: members create; the organiser or an admin edits and cancels.
 * - RSVP: everyone in the workspace, guests included (a visiting mentor can
 *   come to a build night). Guests never create or edit events.
 * - Shoutouts: members give; the giver or an admin removes. Guests read.
 */

const atLeast = (m: RoleHolder, min: "GUEST" | "MEMBER" | "ADMIN") => m != null && hasRoleAtLeast(m.role, min);

export const canManageAnnouncements = (m: RoleHolder) => atLeast(m, "ADMIN");

export const canCreateEvents = (m: RoleHolder) => atLeast(m, "MEMBER");

/** Edit or cancel: admins, or the member who created the event. */
export function canEditEvent(m: RoleHolder, event: { createdById: string | null }, userId: string): boolean {
  if (atLeast(m, "ADMIN")) return true;
  return atLeast(m, "MEMBER") && event.createdById !== null && event.createdById === userId;
}

export const canRsvp = (m: RoleHolder) => atLeast(m, "GUEST");

export const canGiveShoutouts = (m: RoleHolder) => atLeast(m, "MEMBER");

/** Remove a shoutout: the person who gave it, or an admin. */
export function canDeleteShoutout(m: RoleHolder, shoutout: { fromId: string }, userId: string): boolean {
  if (atLeast(m, "ADMIN")) return true;
  return atLeast(m, "MEMBER") && shoutout.fromId === userId;
}

/** Personal and community calendar feeds: any active member, guests included. */
export const canSubscribeToCalendar = (m: RoleHolder) => atLeast(m, "GUEST");
