import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DESTINATION_KINDS, DESTINATION_PROVIDER, destinationConfigSchemas, destinationSecretsSchema, needsConnection, requiredSecrets, webhookUrlProblem } from "@/lib/integrations/destinationConfig";
import { openDestinationSecrets, sealDestinationSecrets, urlHint } from "@/lib/integrations/destinationSecrets";
import { checkPublicUrl } from "@/lib/integrations/ssrf";
import { normalizeEventPatterns } from "./patterns";
import { parseQuietHours } from "@/lib/notify/quietHours";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";

const id = z.string().min(1).max(64);
const destinationSchema = z.object({ id: id.optional(), name: z.string().trim().min(1).max(80), kind: z.enum(DESTINATION_KINDS), connectionId: id.nullish(), config: z.unknown(), secrets: destinationSecretsSchema.default({}), enabled: z.boolean().default(true) });
export async function saveDestination(workspaceId: string, actorId: string, raw: unknown) {
  const input = destinationSchema.parse(raw);
  const config = destinationConfigSchemas[input.kind].parse(input.config) as Record<string, unknown>;
  const existing = input.id ? await prisma.notificationDestination.findFirst({ where: { id: input.id, workspaceId } }) : null;
  if (input.id && !existing) throw new Error("Destination not found. Refresh and try again.");
  if (existing && existing.kind !== input.kind) throw new Error("Create a new destination to change its provider.");
  const secrets = { ...openDestinationSecrets(existing?.secretEnc), ...Object.fromEntries(Object.entries(input.secrets).filter(([, v]) => Boolean(v))) };
  for (const field of requiredSecrets(input.kind, String(config.mode))) if (!secrets[field]) throw new Error("Enter the required credentials.");
  if (secrets.webhookUrl) {
    const problem = webhookUrlProblem(input.kind, secrets.webhookUrl);
    if (problem) throw new Error(problem);
    const safe = await checkPublicUrl(secrets.webhookUrl);
    if (!safe.ok) throw new Error(safe.error);
    if (input.kind === "WEBHOOK") config.urlHint = urlHint(secrets.webhookUrl);
  }
  let connectionId: string | null = null;
  if (needsConnection(input.kind, String(config.mode))) {
    const connection = await prisma.messagingConnection.findFirst({ where: { id: input.connectionId ?? "", workspaceId, provider: DESTINATION_PROVIDER[input.kind], status: "ACTIVE", lastVerifiedAt: { not: null } } });
    if (!connection) throw new Error("Pick a verified messaging connection in this workspace.");
    connectionId = connection.id;
  }
  if (input.kind === "WORKSPACE_CHANNEL" && !await prisma.channel.findFirst({ where: { id: String(config.channelId), workspaceId, archivedAt: null }, select: { id: true } })) throw new Error("Pick a channel in this workspace.");
  for (const [key, table] of [["userIds", "membership"], ["teamIds", "team"]] as const) {
    const ids = config[key] as string[] | undefined;
    if (!ids?.length) continue;
    const count = table === "membership" ? await prisma.membership.count({ where: { workspaceId, status: "ACTIVE", userId: { in: ids } } }) : await prisma.team.count({ where: { workspaceId, id: { in: ids } } });
    if (count !== new Set(ids).size) throw new Error("Pick people and teams in this workspace.");
  }
  return prisma.$transaction(async tx => {
    const data = { name: input.name, connectionId, config: config as Prisma.InputJsonValue, secretEnc: sealDestinationSecrets(secrets), enabled: input.enabled, health: "UNKNOWN" as const, lastError: null };
    const row = existing ? await tx.notificationDestination.update({ where: { id: existing.id, workspaceId }, data }) : await tx.notificationDestination.create({ data: { ...data, workspaceId, kind: input.kind, createdById: actorId } });
    await recordAuditEvent({ workspaceId, actorId, action: "integrations.destination_saved", targetType: "notification_destination", targetId: row.id, client: tx });
    await recordActivity({ workspaceId, actorId, verb: "updated", entityType: "notification_routing", entityId: row.id, summary: "Updated notification routing.", visibility: "PRIVATE" }, tx);
    return row.id;
  });
}
const ruleSchema = z.object({ id: id.optional(), name: z.string().trim().min(1).max(80), eventTypes: z.array(z.string()).min(1).max(100), minSeverity: z.enum(["INFO", "WARNING", "CRITICAL"]), filters: z.object({ projectIds: z.array(id).max(50).optional(), monitorIds: z.array(id).max(50).optional(), tagsAny: z.array(z.string().min(1).max(64)).max(50).optional() }).default({}), quietHours: z.unknown().optional(), criticalBypassesQuiet: z.boolean().default(true), dedupeWindowSec: z.number().int().min(0).max(86400), reminderIntervalMin: z.number().int().min(0).max(10080), enabled: z.boolean().default(true), destinationIds: z.array(id).min(1).max(50) });
export async function saveRule(workspaceId: string, actorId: string, raw: unknown) {
  const input = ruleSchema.parse(raw);
  const normalized = normalizeEventPatterns(input.eventTypes);
  if (!normalized.ok) throw new Error(normalized.error);
  const quiet = input.quietHours ? parseQuietHours(input.quietHours) : null;
  if (input.quietHours && !quiet) throw new Error("Check the quiet hours and time zone.");
  if (input.id && !await prisma.notificationRule.findFirst({ where: { id: input.id, workspaceId, scopeType: "WORKSPACE" } })) throw new Error("Rule not found. Refresh and try again.");
  const destinationIds = [...new Set(input.destinationIds)];
  if (await prisma.notificationDestination.count({ where: { workspaceId, id: { in: destinationIds } } }) !== destinationIds.length) throw new Error("Pick destinations in this workspace.");
  for (const [key, table] of [["projectIds", "project"], ["monitorIds", "monitor"]] as const) {
    const ids = input.filters[key];
    if (!ids?.length) continue;
    const where = { workspaceId, id: { in: ids } };
    const count = table === "project" ? await prisma.project.count({ where }) : await prisma.monitor.count({ where });
    if (count !== new Set(ids).size) throw new Error("Pick filters in this workspace.");
  }
  return prisma.$transaction(async tx => {
    const data = { name: input.name, eventTypes: normalized.patterns, minSeverity: input.minSeverity, filters: input.filters, quietHours: quiet ? quiet as Prisma.InputJsonValue : Prisma.DbNull, criticalBypassesQuiet: input.criticalBypassesQuiet, dedupeWindowSec: input.dedupeWindowSec, reminderIntervalMin: input.reminderIntervalMin, enabled: input.enabled };
    const row = input.id ? await tx.notificationRule.update({ where: { id: input.id, workspaceId, scopeType: "WORKSPACE" }, data }) : await tx.notificationRule.create({ data: { ...data, workspaceId, scopeType: "WORKSPACE", createdById: actorId } });
    await tx.notificationRuleDestination.deleteMany({ where: { ruleId: row.id, rule: { workspaceId } } });
    await tx.notificationRuleDestination.createMany({ data: destinationIds.map(destinationId => ({ ruleId: row.id, destinationId })) });
    await recordAuditEvent({ workspaceId, actorId, action: "integrations.rule_saved", targetId: row.id, client: tx });
    await recordActivity({ workspaceId, actorId, verb: "updated", entityType: "notification_routing", entityId: row.id, summary: "Updated notification routing.", visibility: "PRIVATE" }, tx);
    return row.id;
  });
}
