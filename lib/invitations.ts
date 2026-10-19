import "server-only";

import bcrypt from "bcryptjs";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { enqueueInviteEmail } from "@/lib/outbox";
import { joinedFromInvitation } from "@/lib/people/inviteHook";
import { joinDefaultChannels } from "@/lib/workspaces";
import {
  createInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  invitationUrl,
  isPlausibleInvitationToken,
} from "@/lib/invitationTokens";

export * from "@/lib/invitationTokens";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Create (or replace) a pending invitation and queue the email in the same
 * transaction. Callers must have checked `canManageMembers` and that `role`
 * is in `assignableRoles(actor)`.
 */
export async function createInvitation(input: {
  workspace: { id: string; name: string };
  email: string;
  role: WorkspaceRole;
  invitedBy: { id: string; name: string | null };
}): Promise<Result<{ invitationId: string }>> {
  const email = input.email.trim().toLowerCase();
  const existingMember = await prisma.membership.findFirst({
    where: { workspaceId: input.workspace.id, user: { email } },
    select: { id: true },
  });
  if (existingMember) return { ok: false, error: "That person is already a member of this workspace." };

  const { token, tokenHash } = createInvitationToken();
  const expiresAt = invitationExpiry();
  const invitation = await prisma.$transaction(async (tx) => {
    // One live invitation per email: revoke older pending ones.
    await tx.invitation.updateMany({
      where: { workspaceId: input.workspace.id, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.invitation.create({
      data: { workspaceId: input.workspace.id, email, role: input.role, tokenHash, expiresAt, invitedById: input.invitedBy.id },
      select: { id: true },
    });
    await enqueueInviteEmail(tx, {
      workspaceId: input.workspace.id,
      to: email,
      workspaceName: input.workspace.name,
      inviterName: input.invitedBy.name,
      role: input.role,
      inviteUrl: invitationUrl(token),
      expiresAt,
    });
    await recordAuditEvent({
      client: tx,
      action: "invite.created",
      workspaceId: input.workspace.id,
      actorId: input.invitedBy.id,
      targetType: "Invitation",
      targetId: created.id,
      metadata: { role: input.role },
    });
    return created;
  });
  return { ok: true, invitationId: invitation.id };
}

/** Rotate the token, extend the expiry and send the email again. */
export async function resendInvitation(input: { workspace: { id: string; name: string }; invitationId: string; actor: { id: string; name: string | null } }): Promise<Result> {
  const { token, tokenHash } = createInvitationToken();
  const expiresAt = invitationExpiry();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.invitation.updateMany({
      where: { id: input.invitationId, workspaceId: input.workspace.id, acceptedAt: null, revokedAt: null },
      data: { tokenHash, expiresAt, lastSentAt: new Date() },
    });
    if (updated.count !== 1) return { ok: false as const, error: "That invitation can no longer be resent." };
    const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: input.invitationId }, select: { email: true, role: true } });
    await enqueueInviteEmail(tx, {
      workspaceId: input.workspace.id,
      to: invitation.email,
      workspaceName: input.workspace.name,
      inviterName: input.actor.name,
      role: invitation.role,
      inviteUrl: invitationUrl(token),
      expiresAt,
    });
    await recordAuditEvent({ client: tx, action: "invite.resent", workspaceId: input.workspace.id, actorId: input.actor.id, targetType: "Invitation", targetId: input.invitationId });
    return { ok: true as const };
  });
}

export async function revokeInvitation(input: { workspaceId: string; invitationId: string; actorId: string }): Promise<Result> {
  const updated = await prisma.invitation.updateMany({
    where: { id: input.invitationId, workspaceId: input.workspaceId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count !== 1) return { ok: false, error: "That invitation is no longer pending." };
  await recordAuditEvent({ action: "invite.revoked", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "Invitation", targetId: input.invitationId });
  return { ok: true };
}

/** Look up a pending, unexpired invitation by its raw token (for the /invite page). */
export async function findPendingInvitation(token: string) {
  if (!isPlausibleInvitationToken(token)) return null;
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspace: { select: { id: true, slug: true, name: true, tagline: true, archivedAt: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date() || invitation.workspace.archivedAt) return null;
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
  return { ...invitation, existingAccount: Boolean(existingUser) };
}

export type AcceptAs =
  | { kind: "existing"; userId: string }
  | { kind: "new"; name: string; password: string };

/**
 * Accept an invitation exactly once. The claim is a conditional update on the
 * invitation row, so concurrent attempts produce one membership. An existing
 * account must be the invited email; a new account is created for that email
 * (verified: the person proved they read the inbox).
 */
export async function acceptInvitation(token: string, as: AcceptAs): Promise<Result<{ workspaceSlug: string; userId: string }>> {
  if (!isPlausibleInvitationToken(token)) return { ok: false, error: "This invitation link isn't valid. Ask for a new one." };
  const tokenHash = hashInvitationToken(token);
  const passwordHash = as.kind === "new" ? await bcrypt.hash(as.password, 12) : null;

  const result = await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      select: { id: true, email: true, role: true, workspaceId: true, invitedById: true, workspace: { select: { slug: true, name: true, archivedAt: true } } },
    });
    if (!invitation || invitation.workspace.archivedAt) return { ok: false as const, error: "This invitation link isn't valid. Ask for a new one." };

    let userId: string;
    if (as.kind === "existing") {
      const user = await tx.user.findUnique({ where: { id: as.userId }, select: { id: true, email: true, disabledAt: true } });
      if (!user || user.disabledAt) return { ok: false as const, error: "Sign in again, then open the invitation link." };
      if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        return { ok: false as const, error: `This invitation was sent to a different email address. Sign in with that account to accept it.` };
      }
      userId = user.id;
    } else {
      const taken = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
      if (taken) return { ok: false as const, error: "An account with this email already exists. Sign in to accept the invitation." };
      userId = "";
    }

    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) return { ok: false as const, error: "This invitation has already been used or has expired. Ask for a new one." };

    if (as.kind === "new") {
      const user = await tx.user.create({
        data: { email: invitation.email, name: as.name.trim(), passwordHash, emailVerified: new Date() },
        select: { id: true },
      });
      userId = user.id;
    }
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedById: userId } });

    const existingMembership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } }, select: { id: true } });
    let afterJoined: (() => Promise<void>) | null = null;
    if (!existingMembership) {
      await tx.membership.create({ data: { userId, workspaceId: invitation.workspaceId, role: invitation.role } });
      await joinDefaultChannels(tx, invitation.workspaceId, userId);
      afterJoined = await joinedFromInvitation(tx, { workspace: { id: invitation.workspaceId, slug: invitation.workspace.slug }, userId, role: invitation.role, invitedById: invitation.invitedById });
    }
    await recordAuditEvent({
      client: tx,
      action: "invite.accepted",
      workspaceId: invitation.workspaceId,
      actorId: userId,
      targetType: "Invitation",
      targetId: invitation.id,
      metadata: { role: invitation.role, newAccount: as.kind === "new" },
    });
    return { ok: true as const, workspaceSlug: invitation.workspace.slug, workspaceId: invitation.workspaceId, invitedById: invitation.invitedById, userId, afterJoined };
  });

  if (!result.ok) return result;
  await result.afterJoined?.();
  return { ok: true, workspaceSlug: result.workspaceSlug, userId: result.userId };
}
