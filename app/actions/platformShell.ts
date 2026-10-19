"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, type ActionResult } from "@/lib/actionResult";
const schema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(80),
  issuer: z
    .url()
    .max(500)
    .refine((s) => {
      const u = new URL(s);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }),
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().max(4000).optional(),
  allowedDomains: z
    .array(
      z
        .string()
        .toLowerCase()
        .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/),
    )
    .max(30),
  enabled: z.boolean(),
});
export async function saveOidcProvider(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("apiWrite", session.user.id))
    return actionError("Wait a minute and try again.");
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return actionError(
      "Enter an HTTPS issuer, client ID and allowed email domains.",
    );
  const { id, clientSecret, ...data } = parsed.data;
  const existing = id
    ? await prisma.ssoProvider.findFirst({
        where: { id, workspaceId: null },
        select: { id: true, issuer: true, clientId: true },
      })
    : null;
  if (id && !existing)
    return actionError("This provider is unavailable. Refresh and try again.");
  if (!existing && !clientSecret)
    return actionError("Enter a client secret for the new provider.");
  if (
    existing &&
    (existing.issuer !== data.issuer || existing.clientId !== data.clientId)
  )
    return actionError(
      "Create a new provider to change the issuer or client ID.",
    );
  try {
    await prisma.$transaction(async (tx) => {
      const secret = clientSecret
        ? encryptSecret("sso-secrets", clientSecret)
        : undefined;
      const row = existing
        ? await tx.ssoProvider.update({
            where: { id: existing.id, workspaceId: null },
            data: { ...data, ...(secret ? { clientSecretEnc: secret } : {}) },
          })
        : await tx.ssoProvider.create({
            data: { ...data, clientSecretEnc: secret! },
          });
      await recordAuditEvent({
        actorId: session.user.id,
        action: "shell.sso_updated",
        targetId: row.id,
        targetType: "SsoProvider",
        client: tx,
      });
    });
    revalidatePath("/admin/sso");
    revalidatePath("/login");
    return { ok: true };
  } catch {
    return actionError(
      "Couldn't save the provider. Check the encryption key and try again.",
    );
  }
}
