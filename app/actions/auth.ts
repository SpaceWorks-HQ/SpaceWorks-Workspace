"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { hashPasswordResetToken, PASSWORD_RESET_TTL_MS } from "@/lib/passwordResetToken";
import { enqueuePasswordReset } from "@/lib/outbox";
import { getCurrentUser } from "@/lib/permissions";
import { acceptInvitation } from "@/lib/invitations";
import { isSetupOpen, performSetup } from "@/lib/setup";
import { actionError, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { emailSchema, nameSchema, newPasswordSchema, timeZoneSchema, workspaceSlugSchema } from "@/lib/validation";

const setupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  workspaceName: z.string().trim().min(2, "Enter a workspace name.").max(80),
  workspaceSlug: workspaceSlugSchema,
  timezone: timeZoneSchema.optional(),
});

/** First-run only: create the instance owner and first workspace. The client then signs in. */
export async function completeSetup(input: unknown): Promise<ActionResult<{ workspaceSlug: string }>> {
  if (await isActionRateLimited("setup")) return actionError(RATE_LIMITED);
  if (!(await isSetupOpen())) return actionError("Setup is already complete. Sign in instead.");
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await performSetup(parsed.data);
  if (!result.ok) return actionError(result.error);
  return { ok: true, data: { workspaceSlug: result.workspaceSlug } };
}

/** Always answers the same way so the form never reveals which emails have accounts. */
export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ email: emailSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (await isActionRateLimited("passwordReset", parsed.data.email)) return actionError(RATE_LIMITED);
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, disabledAt: true } });
  if (user && !user.disabledAt) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashPasswordResetToken(token), expiresAt } });
      await enqueuePasswordReset(tx, { to: parsed.data.email, resetUrl: `${base}/reset-password/${token}`, expiresAt });
      await recordAuditEvent({ client: tx, action: "auth.password_reset_requested", actorId: user.id, targetType: "User", targetId: user.id });
    });
  }
  return { ok: true };
}

const resetSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This reset link isn't valid."), password: newPasswordSchema });

/** Consume a reset token once, set the password and sign out every session. */
export async function resetPassword(input: unknown): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (await isActionRateLimited("passwordReset")) return actionError(RATE_LIMITED);
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const done = await prisma.$transaction(async (tx) => {
    const token = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!token) return false;
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return false;
    await tx.user.update({ where: { id: token.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: token.userId } });
    await recordAuditEvent({ client: tx, action: "auth.password_reset", actorId: token.userId, targetType: "User", targetId: token.userId });
    return true;
  });
  return done ? { ok: true } : actionError("This reset link has expired or was already used. Ask for a new one.");
}

const acceptNewSchema = z.object({ token: z.string().min(1).max(64), name: nameSchema, password: newPasswordSchema });

/** Accept an invitation by creating a new account for the invited email. The client then signs in. */
export async function acceptInviteWithNewAccount(input: unknown): Promise<ActionResult<{ workspaceSlug: string }>> {
  const parsed = acceptNewSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (await isActionRateLimited("inviteAccept")) return actionError(RATE_LIMITED);
  const result = await acceptInvitation(parsed.data.token, { kind: "new", name: parsed.data.name, password: parsed.data.password });
  return result.ok ? { ok: true, data: { workspaceSlug: result.workspaceSlug } } : actionError(result.error);
}

/** Accept an invitation as the signed-in member (must be the invited email). */
export async function acceptInviteAsCurrentUser(input: unknown): Promise<ActionResult<{ workspaceSlug: string }>> {
  const parsed = z.object({ token: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return actionError("This invitation link isn't valid.");
  const user = await getCurrentUser();
  if (!user) return actionError("Sign in first, then open the invitation link again.");
  if (await isActionRateLimited("inviteAccept", user.id)) return actionError(RATE_LIMITED);
  const result = await acceptInvitation(parsed.data.token, { kind: "existing", userId: user.id });
  return result.ok ? { ok: true, data: { workspaceSlug: result.workspaceSlug } } : actionError(result.error);
}
