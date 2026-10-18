import "server-only";

import type { Membership, Workspace } from "@prisma/client";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { hasValidSuperAdminMfaProof, SUPER_ADMIN_MFA_COOKIE } from "@/lib/superAdminMfa";
import type { WorkspaceRole } from "@prisma/client";

export * from "@/lib/roles";

export type SessionUser = { id: string; name: string | null; email: string; image: string | null };

/** The signed-in, enabled user (read from the database), or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, image: true, disabledAt: true },
  });
  if (!user || user.disabledAt) return null;
  return { id: user.id, name: user.name, email: user.email, image: user.image };
});

/** Pages and actions: redirect to /login when signed out (or disabled). */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type WorkspaceContext = {
  user: SessionUser;
  workspace: Workspace;
  membership: Membership;
};

/**
 * Resolve a workspace by slug for the signed-in user. Non-members, suspended
 * members, archived workspaces and unknown slugs all get the same notFound(),
 * so a slug never reveals whether a workspace exists. Members below
 * `minRole` also get notFound() (the page simply does not exist for them).
 */
export const requireWorkspace = cache(async (slug: string, minRole: WorkspaceRole = "GUEST"): Promise<WorkspaceContext> => {
  const user = await requireAuth();
  const context = await findWorkspaceForUser(slug, user.id);
  if (!context || !hasRoleAtLeast(context.membership.role, minRole)) notFound();
  return { user, ...context };
});

/** Non-throwing lookup used by route handlers (which return their own 404). */
export async function findWorkspaceForUser(slug: string, userId: string): Promise<{ workspace: Workspace; membership: Membership } | null> {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 64) return null;
  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace || workspace.archivedAt) return null;
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: workspace.id } } });
  if (!membership || membership.status !== "ACTIVE") return null;
  return { workspace, membership };
}

/**
 * Server Action variant: never redirects or throws notFound (those would
 * surface as navigation in the client); returns null so the action can
 * respond `{ error }`.
 */
export async function getWorkspaceForAction(slug: string, minRole: WorkspaceRole = "GUEST"): Promise<WorkspaceContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const context = await findWorkspaceForUser(slug, user.id);
  if (!context || !hasRoleAtLeast(context.membership.role, minRole)) return null;
  return { user, ...context };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isSuperAdminEmail(email: string | null | undefined) {
  const configured = process.env.SUPER_ADMIN_EMAIL;
  return Boolean(configured && email && normalizeEmail(email) === normalizeEmail(configured));
}

/**
 * Instance super-admin: the signed-in user whose email matches
 * SUPER_ADMIN_EMAIL. Everyone else gets notFound() so the panel's existence
 * is not revealed.
 */
export async function requireSuperAdmin(): Promise<Session & { user: { id: string; email: string } }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, disabledAt: true } });
  if (!user || user.disabledAt || !isSuperAdminEmail(user.email)) notFound();
  return { ...session, user: { ...session.user, id: session.user.id, email: user.email } } as Session & { user: { id: string; email: string } };
}

/**
 * Super-admin plus a fresh, separate TOTP step-up. Every app/admin/**\/page.tsx
 * must call this itself: layouts do not re-run on client navigation.
 */
export async function requireSuperAdminMfa() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { mfaEnabledAt: true, sessionVersion: true } });
  const proof = (await cookies()).get(SUPER_ADMIN_MFA_COOKIE)?.value;
  if (!user?.mfaEnabledAt || !hasValidSuperAdminMfaProof(proof, session.user.id, user.sessionVersion)) {
    redirect("/admin-mfa");
  }
  return session;
}
