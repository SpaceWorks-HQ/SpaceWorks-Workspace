import "server-only";

import type { Membership, Workspace } from "@prisma/client";
import { countUnreadNotifications } from "@/lib/notifications";
import { navForMember, type ResolvedNavGroup } from "@/lib/nav";
import { isSuperAdminEmail, type SessionUser } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";
import { listUserWorkspaces, type UserWorkspace } from "@/lib/workspaces";

export type ShellData = {
  user: { name: string | null; email: string; image: string | null };
  workspace: { slug: string; name: string; roleLabel: string };
  workspaces: UserWorkspace[];
  nav: ResolvedNavGroup[];
  unreadNotifications: number;
  isSuperAdmin: boolean;
};

export async function getShellData(user: SessionUser, workspace: Workspace, membership: Membership): Promise<ShellData> {
  const [workspaces, unread] = await Promise.all([listUserWorkspaces(user.id), countUnreadNotifications(user.id, workspace.id)]);
  return {
    user: { name: user.name, email: user.email, image: user.image },
    workspace: { slug: workspace.slug, name: workspace.name, roleLabel: roleLabel(membership.role) },
    workspaces,
    nav: navForMember(workspace.slug, { role: membership.role, workspace }),
    unreadNotifications: unread,
    isSuperAdmin: isSuperAdminEmail(user.email),
  };
}
