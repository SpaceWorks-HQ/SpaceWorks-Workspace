import "server-only";

import type { RuleScopeType, WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { canPickExternalDestinations } from "@/lib/roles";

/**
 * Data side of the "Send to" picker. An entity (monitor, announcement,
 * subscription, digest…) keeps exactly one scoped NotificationRule; its
 * destinations are what the picker shows. Producers then dispatch events
 * with `scope: { <SCOPE_KEYS[scopeType]>: entityId }` and the rule matches.
 *
 * Call these from the owning area's Server Action after its own permission
 * check. The picker component itself is built with the routing UI.
 */

type ScopedType = Exclude<RuleScopeType, "WORKSPACE">;

/** Destinations this member may choose in a picker: admins any enabled one; members only in-app/channel ones marked memberSelectable. */
export async function listPickableDestinations(workspaceId: string, role: WorkspaceRole, client: DbClient = prisma) {
  const rows = await client.notificationDestination.findMany({
    where: { workspaceId, enabled: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, health: true, config: true },
  });
  const external = canPickExternalDestinations({ role });
  return rows
    .filter((row) => external || ((row.kind === "IN_APP_USERS" || row.kind === "WORKSPACE_CHANNEL") && memberSelectable(row.config)))
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind, health: row.health }));
}

function memberSelectable(config: unknown) {
  return Boolean(config && typeof config === "object" && !Array.isArray(config) && (config as Record<string, unknown>).memberSelectable === true);
}

export async function getScopedDestinationIds(workspaceId: string, scopeType: ScopedType, scopeId: string, client: DbClient = prisma): Promise<string[]> {
  const rule = await client.notificationRule.findUnique({
    where: { workspaceId_scopeType_scopeId: { workspaceId, scopeType, scopeId } },
    select: { destinations: { select: { destinationId: true } } },
  });
  return rule?.destinations.map((row) => row.destinationId) ?? [];
}

/**
 * Replace an entity's "Send to" destinations. Unknown or foreign destination
 * ids are ignored; an empty list removes the scoped rule. Run inside the
 * caller's transaction when the entity is created in the same action.
 */
export async function setScopedDestinations(
  client: DbClient,
  input: { workspaceId: string; scopeType: ScopedType; scopeId: string; destinationIds: string[]; actorId: string | null; eventTypes?: string[]; name?: string },
) {
  const valid = await client.notificationDestination.findMany({
    where: { workspaceId: input.workspaceId, id: { in: [...new Set(input.destinationIds)].slice(0, 50) } },
    select: { id: true },
  });
  const key = { workspaceId_scopeType_scopeId: { workspaceId: input.workspaceId, scopeType: input.scopeType, scopeId: input.scopeId } };
  if (valid.length === 0) {
    await client.notificationRule.deleteMany({ where: { workspaceId: input.workspaceId, scopeType: input.scopeType, scopeId: input.scopeId } });
    return { ruleId: null, destinationIds: [] as string[] };
  }
  const rule = await client.notificationRule.upsert({
    where: key,
    create: {
      workspaceId: input.workspaceId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      name: input.name ?? null,
      eventTypes: input.eventTypes ?? ["*"],
      createdById: input.actorId,
    },
    update: { ...(input.eventTypes ? { eventTypes: input.eventTypes } : {}), ...(input.name ? { name: input.name } : {}) },
    select: { id: true },
  });
  await client.notificationRuleDestination.deleteMany({ where: { ruleId: rule.id } });
  await client.notificationRuleDestination.createMany({ data: valid.map((row) => ({ ruleId: rule.id, destinationId: row.id })) });
  return { ruleId: rule.id, destinationIds: valid.map((row) => row.id) };
}
