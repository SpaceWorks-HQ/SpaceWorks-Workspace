import "server-only";
import { prisma } from "@/lib/db";

import { pinnedLinks } from "@/lib/shell/links";
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
  pinned: { id: string; title: string; url: string }[];
  isSuperAdmin: boolean;
};

export async function getShellData(user: SessionUser, workspace: Workspace, membership: Membership): Promise<ShellData> {
  const [workspaces, unread, pinned] = await Promise.all([listUserWorkspaces(user.id), countUnreadNotifications(user.id, workspace.id), pinnedLinks({ workspaceId: workspace.id, userId: user.id, role: membership.role })]);
  const payrollGrant = await prisma.financePayrollGrant.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } }, select: { id: true } });
  return {
    user: { name: user.name, email: user.email, image: user.image },
    workspace: { slug: workspace.slug, name: workspace.name, roleLabel: roleLabel(membership.role) },
    workspaces,
    pinned,
    nav: navForMember(workspace.slug, { role: membership.role, workspace, payrollAccess: !!payrollGrant }),
    unreadNotifications: unread,
    isSuperAdmin: isSuperAdminEmail(user.email),
  };
}
