"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { createInvitation } from "@/lib/invitations";
import { isInstanceSettingKey, setInstanceSettings, type InstanceSettingKey } from "@/lib/instanceSettings";
import { consumeMfaCode, decryptMfaSecret } from "@/lib/mfa";
import { requireSuperAdmin, requireSuperAdminMfa } from "@/lib/permissions";
import { createSuperAdminMfaProof, SUPER_ADMIN_MFA_COOKIE, SUPER_ADMIN_MFA_MAX_AGE_SECONDS } from "@/lib/superAdminMfa";
import { createWorkspaceWithDefaults } from "@/lib/workspaces";
import { actionError, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { emailSchema, idSchema, workspaceSlugSchema } from "@/lib/validation";

/** Fresh TOTP step-up for the instance admin area; sets a short-lived signed cookie. */
export async function verifyAdminMfa(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdmin();
  if (await isActionRateLimited("auth", session.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(input);
  if (!parsed.success) return actionError("Enter the six-digit code from your authenticator app.");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, mfaSecretEncrypted: true, mfaEnabledAt: true, sessionVersion: true } });
  if (!user?.mfaEnabledAt || !user.mfaSecretEncrypted) return actionError("Turn on two-step verification in your account first.");
  let valid = false;
  try {
    valid = await consumeMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, parsed.data.code);
  } catch {
    return actionError("Couldn't check the code. Try again.");
  }
  if (!valid) return actionError("That code didn't work. Wait for the next one and try again.");
  (await cookies()).set(SUPER_ADMIN_MFA_COOKIE, createSuperAdminMfaProof(session.user.id, user.sessionVersion), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SUPER_ADMIN_MFA_MAX_AGE_SECONDS,
    priority: "high",
  });
  await recordAuditEvent({ action: "admin.mfa_verified", actorId: session.user.id, targetType: "User", targetId: session.user.id });
  return { ok: true };
}

const settingsSchema = z.record(z.string(), z.union([z.string().max(4000), z.null()]));

/** Write-only for secrets: empty secret fields are left unchanged. */
export async function updateInstanceSettingsAction(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id)) return actionError(RATE_LIMITED);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return actionError("Check the settings and try again.");
  const updates: Partial<Record<InstanceSettingKey, string | null>> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!isInstanceSettingKey(key)) return actionError("Unknown setting.");
    updates[key] = value;
  }
  const changed = await setInstanceSettings(updates, session.user.id);
  // Keys only: values (and especially secrets) never reach the audit log.
  await recordAuditEvent({ action: "admin.instance_settings_updated", actorId: session.user.id, metadata: { keys: Object.keys(updates).join(","), changed } });
  revalidatePath("/admin", "layout");
  return { ok: true };
}

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Enter a workspace name.").max(80),
  slug: workspaceSlugSchema,
  ownerEmail: emailSchema,
});

/** Create a workspace. An existing user becomes its owner; otherwise they get an owner invitation. */
export async function adminCreateWorkspace(input: unknown): Promise<ActionResult<{ slug: string; invited: boolean }>> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id)) return actionError(RATE_LIMITED);
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (await prisma.workspace.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } })) {
    return actionError("That address is taken.", { slug: ["That address is taken."] });
  }
  const owner = await prisma.user.findUnique({ where: { email: parsed.data.ownerEmail }, select: { id: true } });
  const adminName = (await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } }))?.name ?? null;
  const workspace = await prisma.$transaction(async (tx) => {
    // The admin is the initial owner when the named owner has no account yet.
    const created = await createWorkspaceWithDefaults(tx, { name: parsed.data.name, slug: parsed.data.slug, ownerId: owner?.id ?? session.user.id });
    await recordAuditEvent({ client: tx, action: "admin.workspace_created", workspaceId: created.id, actorId: session.user.id, targetType: "Workspace", targetId: created.id });
    return created;
  });
  if (!owner) {
    await createInvitation({ workspace, email: parsed.data.ownerEmail, role: "OWNER", invitedBy: { id: session.user.id, name: adminName } });
  }
  revalidatePath("/admin/workspaces");
  return { ok: true, data: { slug: workspace.slug, invited: !owner } };
}

export async function adminSetUserDisabled(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  const parsed = z.object({ userId: idSchema, disabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return actionError("Couldn't update that account.");
  if (parsed.data.userId === session.user.id) return actionError("You can't disable your own account.");
  const updated = await prisma.user.updateMany({
    where: { id: parsed.data.userId },
    data: parsed.data.disabled ? { disabledAt: new Date(), sessionVersion: { increment: 1 } } : { disabledAt: null },
  });
  if (updated.count !== 1) return actionError("That account wasn't found.");
  if (parsed.data.disabled) await prisma.session.deleteMany({ where: { userId: parsed.data.userId } });
  await recordAuditEvent({ action: parsed.data.disabled ? "admin.user_disabled" : "admin.user_enabled", actorId: session.user.id, targetType: "User", targetId: parsed.data.userId });
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function adminSetWorkspaceArchived(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  const parsed = z.object({ workspaceId: idSchema, archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return actionError("Couldn't update that workspace.");
  const updated = await prisma.workspace.updateMany({ where: { id: parsed.data.workspaceId }, data: { archivedAt: parsed.data.archived ? new Date() : null } });
  if (updated.count !== 1) return actionError("That workspace wasn't found.");
  await recordAuditEvent({ action: parsed.data.archived ? "admin.workspace_archived" : "admin.workspace_restored", workspaceId: parsed.data.workspaceId, actorId: session.user.id, targetType: "Workspace", targetId: parsed.data.workspaceId });
  revalidatePath("/admin/workspaces");
  return { ok: true };
}
