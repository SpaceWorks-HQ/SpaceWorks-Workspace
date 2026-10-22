import { hasRoleAtLeast, type RoleHolder } from "@/lib/roles";

export const canManageAnnouncements = (m: RoleHolder) => m != null && hasRoleAtLeast(m.role, "ADMIN");

/** Personal feed links require an active workspace membership. */
export const canSubscribeToCalendar = (m: RoleHolder) => m != null && hasRoleAtLeast(m.role, "GUEST");
