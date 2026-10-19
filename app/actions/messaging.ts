"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { integrationAccess } from "@/lib/integrations/access";
import { sealCredentials, openCredentials } from "@/lib/messaging/credentials";
import { MESSAGING_PROVIDERS, CREDENTIAL_FIELDS, CONFIG_FIELDS, type ProviderCredentials } from "@/lib/messaging/providers";
import { randomToken } from "@/lib/crypto";
import { verifyConnection } from "@/lib/messaging/verify";
import { newLinkCode } from "@/lib/messaging/linking";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { checkPublicUrl } from "@/lib/integrations/ssrf";
import type { ActionResult } from "@/lib/actionResult";
const id = z.string().min(1).max(64);
export async function updateMessaging(slug: string, raw: unknown): Promise<ActionResult<{ code?: string }>> {
  try {
    const operation = z.object({ operation: z.enum(["save", "verify", "delete", "bridge", "deleteBridge", "link", "unlink"]), id: id.optional(), data: z.unknown().optional() }).parse(raw);
    const personal = operation.operation === "link" || operation.operation === "unlink";
    const { workspace, user } = await integrationAccess(slug, personal ? "MEMBER" : "ADMIN");
    const workspaceId = workspace.id;
    let code: string | undefined;
    if (operation.operation === "save") {
      const input = z.object({ id: id.optional(), provider: z.enum(MESSAGING_PROVIDERS), label: z.string().trim().min(1).max(80), credentials: z.record(z.string(), z.string().max(4096)), config: z.record(z.string(), z.string().max(2048)) }).parse(operation.data);
      const old = input.id ? await prisma.messagingConnection.findFirst({ where: { id: input.id, workspaceId, provider: input.provider } }) : null;
      if (input.id && !old) throw new Error("Connection not found.");
      const credentials = { ...(old ? openCredentials(old) : {}), ...Object.fromEntries(Object.entries(input.credentials).filter(([, v]) => v)) } as Record<string, string>;
      for (const field of CREDENTIAL_FIELDS[input.provider]) if (field.required && !credentials[field.key]) throw new Error(`Enter ${field.label.toLowerCase()}.`);
      for (const field of CONFIG_FIELDS[input.provider]) if (field.required && !input.config[field.key]) throw new Error(`Enter ${field.label.toLowerCase()}.`);
      if (input.provider === "TELEGRAM") credentials.webhookSecret = randomToken();
      if (input.provider === "WHATSAPP" && !credentials.verifyToken) throw new Error("Enter the webhook verification token you chose in Meta settings.");
      if (input.provider === "DISCORD" && !/^[a-f\d]{64}$/i.test(input.config.publicKey ?? "")) throw new Error("Enter the 64-character Discord public key.");
      if (input.provider === "MATTERMOST") { const safe = await checkPublicUrl(input.config.serverUrl ?? ""); if (!safe.ok) throw new Error(safe.error); }
      const config = Object.fromEntries(CONFIG_FIELDS[input.provider].filter(f => input.config[f.key]).map(f => [f.key, input.config[f.key]]));
      const data = { label: input.label, ...sealCredentials(input.provider, credentials as unknown as ProviderCredentials[typeof input.provider]), config, lastVerifiedAt: null, status: "ERROR" as const, lastError: "Verify this connection before using it." };
      if (old) await prisma.messagingConnection.updateMany({ where: { id: old.id, workspaceId }, data });
      else await prisma.$transaction(async tx => {
        if (input.provider === "TELEGRAM") {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sww:telegram:${workspaceId}`}))`;
          if (await tx.messagingConnection.findFirst({ where: { workspaceId, provider: "TELEGRAM" } })) throw new Error("Edit the existing Telegram connection for this workspace.");
        }
        await tx.messagingConnection.create({ data: { ...data, workspaceId, provider: input.provider, createdById: user.id } });
      });
    } else if (operation.operation === "bridge") {
      const input = z.object({ connectionId: id, workspaceChannelId: id, externalChannelId: z.string().min(1).max(128), direction: z.enum(["INBOUND", "OUTBOUND", "BOTH"]) }).parse(operation.data);
      const connection = await prisma.messagingConnection.findFirst({ where: { id: input.connectionId, workspaceId, status: "ACTIVE", lastVerifiedAt: { not: null } } });
      const channel = await prisma.channel.findFirst({ where: { id: input.workspaceChannelId, workspaceId, archivedAt: null, kind: "PUBLIC", teamId: null } });
      if (!connection || !channel) throw new Error("Choose a verified connection and a public workspace channel without a team restriction.");
      if (connection.provider === "WHATSAPP") throw new Error("WhatsApp does not support channel bridges.");
      await prisma.bridgedChannel.create({ data: { ...input, workspaceId, createdById: user.id } });
    } else if (operation.operation === "deleteBridge") await prisma.bridgedChannel.deleteMany({ where: { id: operation.id ?? "", workspaceId } });
    else if (operation.operation === "unlink") await prisma.externalIdentityLink.deleteMany({ where: { id: operation.id ?? "", workspaceId, userId: user.id } });
    else {
      const connection = await prisma.messagingConnection.findFirst({ where: { id: operation.id ?? "", workspaceId } });
      if (!connection) throw new Error("Connection not found.");
      if (operation.operation === "verify") await verifyConnection(connection);
      if (operation.operation === "delete") await prisma.messagingConnection.deleteMany({ where: { id: connection.id, workspaceId } });
      if (operation.operation === "link") {
        if (connection.status !== "ACTIVE" || !connection.lastVerifiedAt) throw new Error("Ask an admin to verify this connection first.");
        const generated = newLinkCode(); code = generated.code;
        await prisma.$transaction(async tx => {
          await tx.linkCode.deleteMany({ where: { workspaceId, userId: user.id, connectionId: connection.id, usedAt: null } });
          await tx.linkCode.create({ data: { workspaceId, userId: user.id, provider: connection.provider, connectionId: connection.id, codeHash: generated.codeHash, expiresAt: generated.expiresAt } });
        });
      }
    }
    await recordAuditEvent({ workspaceId, actorId: user.id, action: `integrations.messaging_${operation.operation}`, targetId: operation.id });
    if (["save", "delete", "bridge", "deleteBridge"].includes(operation.operation)) await recordActivity({ workspaceId, actorId: user.id, verb: "updated", entityType: "messaging", entityId: operation.id ?? workspaceId, summary: "Updated workspace messaging settings.", visibility: "PRIVATE" });
    revalidatePath(`/w/${slug}/settings/messaging`); revalidatePath(`/w/${slug}/notifications/accounts`);
    return { ok: true, data: { ...(code ? { code } : {}) } };
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? "Check the connection fields." : error instanceof Error && error.name === "Error" && !error.message.toLowerCase().includes("prisma") ? error.message.slice(0, 180) : "Couldn't save. Check for an existing connection or bridge." }; }
}
