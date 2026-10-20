import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { canActOnMember, canManageOnboarding } from "@/lib/roles";
import { dispatch } from "@/lib/notify/dispatch";
import { adminIds, type PeopleActor } from "./context";
import { buildRunItems, emptyOffboardingSources, offboardingItems, runProgress, templateItemsSchema } from "./checklistItems";
import { assigneeResolver, createRun, startTemplateRun } from "./checklists";
import { canSeeChecklistRun, canTickChecklistItem } from "./access";
import { idSchema } from "@/lib/validation";

const templateSchema = z.object({ name: z.string().trim().min(1).max(100), kind: z.enum(["ONBOARDING", "OFFBOARDING", "CUSTOM", "EVENT", "OPENING", "CLOSING"]), teamId: idSchema.nullable().default(null), autoStartFor: z.string().max(64).nullable().default(null), items: templateItemsSchema });
export async function saveChecklistTemplate(actor: PeopleActor, input: unknown, id: string | null = null): Promise<ActionResult> {
  if (!canManageOnboarding(actor.membership)) return actionError(NOT_ALLOWED);
  const p = templateSchema.safeParse(input); if (!p.success) return validationError(p.error);
  const data = p.data;
  if (id && !await prisma.checklistTemplate.findFirst({ where: { id, workspaceId: actor.workspace.id }, select: { id: true } })) return actionError(NOT_ALLOWED);
  for (const teamId of new Set([data.teamId, data.autoStartFor && !["CORE", "MEMBER", "VOLUNTEER", "ALUMNI", "OWNER", "ADMIN", "GUEST"].includes(data.autoStartFor) ? data.autoStartFor : null].filter((v): v is string => Boolean(v)))) {
    if (!await prisma.team.findFirst({ where: { id: teamId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true } })) return actionError("Pick a team in this workspace.");
  }
  await prisma.$transaction(async tx => {
    const row = id ? await tx.checklistTemplate.update({ where: { id, workspaceId: actor.workspace.id }, data }) : await tx.checklistTemplate.create({ data: { ...data, workspaceId: actor.workspace.id, createdById: actor.user.id } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.template_saved", targetType: "ChecklistTemplate", targetId: row.id });
  });
  return { ok: true };
}
export async function checklistTemplates(actor: PeopleActor) {
  if (!canManageOnboarding(actor.membership)) return [];
  return prisma.checklistTemplate.findMany({ where: { workspaceId: actor.workspace.id }, orderBy: { name: "asc" } });
}
export async function checklistRuns(actor: PeopleActor) {
  const rows = await prisma.checklistRun.findMany({ where: { workspaceId: actor.workspace.id, items: { none: { sourceType: "availability_request" } }, ...(canManageOnboarding(actor.membership) ? {} : { OR: [{ subjectUserId: actor.user.id }, { items: { some: { assigneeId: actor.user.id } } }] }) }, include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.filter(r => (r.kind !== "OFFBOARDING" || canManageOnboarding(actor.membership)) && canSeeChecklistRun(actor.membership, actor.user.id, r, r.items.flatMap(i => i.assigneeId ? [i.assigneeId] : [])));
}
export async function startChecklist(actor: PeopleActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!canManageOnboarding(actor.membership)) return actionError(NOT_ALLOWED);
  const p = z.object({ templateId: idSchema, userId: idSchema }).safeParse(input); if (!p.success) return validationError(p.error);
  const [template, member] = await Promise.all([prisma.checklistTemplate.findFirst({ where: { workspaceId: actor.workspace.id, id: p.data.templateId } }), prisma.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: p.data.userId, status: "ACTIVE" }, select: { role: true, user: { select: { name: true } } } })]);
  if (!template || !member || (template.kind === "OFFBOARDING" && !canActOnMember(actor.membership, member.role))) return actionError(NOT_ALLOWED);
  if (template.kind === "OFFBOARDING") return startOffboarding(actor, { userId: p.data.userId, templateId: template.id });
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist:${actor.workspace.id}:${p.data.userId}`}))`;
    const existing = await tx.checklistRun.findFirst({ where: { workspaceId: actor.workspace.id, templateId: template.id, subjectUserId: p.data.userId, status: "OPEN" }, select: { id: true } });
    return existing ?? startTemplateRun(tx, { workspaceId: actor.workspace.id, template, subjectUserId: p.data.userId, subjectName: member.user.name, actorId: actor.user.id });
  });
  return { ok: true, data: result };
}
export async function offboardingSources(tx: Prisma.TransactionClient, workspaceId: string, userId: string) {
  const sources = emptyOffboardingSources();
  const membership = await tx.membership.findFirst({ where: { workspaceId, userId }, select: { role: true } });
  if (!membership) return sources;
  const teams = await tx.teamMember.findMany({ where: { userId, team: { workspaceId } }, select: { role: true, team: { select: { id: true, name: true } } } });
  const teamIds = teams.map(t => t.team.id);
  const grants = await tx.vaultGrant.findMany({ where: { workspaceId, permission: { in: ["REVEAL", "EDIT", "MANAGE"] }, OR: [{ principalType: "USER", principalId: userId }, { principalType: "TEAM", principalId: { in: teamIds } }, { principalType: "ROLE", principalId: membership.role }] }, select: { itemId: true, collectionId: true } });
  const [owned, revealed, services, assets, keys, subscriptions, identities, tasks] = await Promise.all([
    tx.vaultItem.findMany({ where: { workspaceId, ownerId: userId, deletedAt: null }, select: { id: true, title: true } }),
    tx.vaultItem.findMany({ where: { workspaceId, deletedAt: null, OR: [{ logs: { some: { workspaceId, userId, action: { in: ["REVEAL", "COPY"] } } } }, { id: { in: grants.flatMap(g => g.itemId ? [g.itemId] : []) } }, { collectionId: { in: grants.flatMap(g => g.collectionId ? [g.collectionId] : []) } }] }, select: { id: true, title: true } }),
    tx.serviceCatalogItem.findMany({ where: { workspaceId, OR: [{ ownerId: userId }, { backupOwnerId: userId }] }, select: { id: true, name: true, ownerId: true } }),
    tx.asset.findMany({ where: { workspaceId, ownerUserId: userId }, select: { id: true, name: true, tag: true } }),
    tx.accessCredential.findMany({ where: { workspaceId, holderUserId: userId, returnedAt: null }, select: { id: true, label: true, type: true } }),
    tx.subscription.findMany({ where: { workspaceId, ownerId: userId }, select: { id: true, name: true } }),
    tx.externalIdentityLink.findMany({ where: { workspaceId, userId }, select: { id: true, provider: true, externalUsername: true } }),
    tx.task.findMany({ where: { workspaceId, assignees: { some: { userId } }, completedAt: null }, select: { id: true, number: true, title: true } }),
  ]);
  const accounts = await tx.fundingRecord.findMany({ where: { workspaceId, kind: "TOOL_ACCOUNT", archivedAt: null, status: { not: "REMOVED" }, details: { path: ["userId"], equals: userId } }, select: { id: true, title: true, details: true } });
  sources.toolAccounts = accounts.map(a => ({ id: a.id, title: a.title, identity: String((a.details as Record<string, unknown>).identity ?? "") }));
  sources.vaultItemsOwned = owned; sources.vaultItemsToRotate = [...revealed, ...owned];
  sources.servicesOwned = services.map(s => ({ ...s, backup: s.ownerId !== userId })); sources.assetsOwned = assets; sources.accessCredentials = keys; sources.subscriptionsOwned = subscriptions;
  sources.identityLinks = identities.map(i => ({ id: i.id, provider: i.provider, username: i.externalUsername })); sources.teams = teams.map(t => ({ ...t.team, lead: t.role === "LEAD" })); sources.openTasks = tasks.map(t => ({ ...t, ref: `Task ${t.number}` }));
  return sources;
}
export async function startOffboarding(actor: PeopleActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!canManageOnboarding(actor.membership)) return actionError(NOT_ALLOWED);
  const p = z.object({ userId: idSchema, templateId: idSchema.optional() }).safeParse(input); if (!p.success) return validationError(p.error);
  const target = await prisma.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: p.data.userId }, select: { role: true, user: { select: { name: true } } } });
  if (!target || p.data.userId === actor.user.id || !canActOnMember(actor.membership, target.role)) return actionError(NOT_ALLOWED);
  const outcome = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist:${actor.workspace.id}:${p.data.userId}`}))`;
    const existing = await tx.checklistRun.findFirst({ where: { workspaceId: actor.workspace.id, subjectUserId: p.data.userId, kind: "OFFBOARDING", status: "OPEN" }, select: { id: true } });
    if (existing) return { run: existing, notify: null };
    const template = p.data.templateId ? await tx.checklistTemplate.findFirst({ where: { workspaceId: actor.workspace.id, id: p.data.templateId, kind: "OFFBOARDING" } }) : null;
    const resolver = await assigneeResolver(tx, actor.workspace.id, p.data.userId, template?.teamId ?? null);
    const templateItems = template ? buildRunItems(templateItemsSchema.parse(template.items), { startAt: new Date(), resolve: resolver }) : [];
    const items = [...templateItems, ...offboardingItems(await offboardingSources(tx, actor.workspace.id, p.data.userId), { adminId: actor.user.id, dueAt: new Date(Date.now() + 7 * 86400000), sortStart: templateItems.length })];
    const run = await createRun(tx, { workspaceId: actor.workspace.id, subjectUserId: p.data.userId, actorId: actor.user.id, kind: "OFFBOARDING", templateId: template?.id ?? null, title: `Offboarding: ${target.user.name || "Member"}`, dueAt: null, items });
    const notify = await dispatch(actor.workspace.id, { type: "offboarding.started", title: "Offboarding checklist is ready", actorId: actor.user.id, recipients: await adminIds(actor.workspace.id, tx), useWorkspaceRules: false, url: `/w/${actor.workspace.slug}/onboarding`, resource: { type: "checklist", id: run.id }, data: { runId: run.id, subjectUserId: p.data.userId } }, { tx });
    return { run, notify };
  });
  await outcome.notify?.afterCommit(); return { ok: true, data: outcome.run };
}
export async function tickChecklistItem(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ id: idSchema, done: z.boolean(), note: z.string().trim().max(1000).default("") }).safeParse(input); if (!p.success) return validationError(p.error);
  return prisma.$transaction(async tx => {
    const item = await tx.checklistRunItem.findFirst({ where: { id: p.data.id, run: { workspaceId: actor.workspace.id, status: "OPEN" }, OR: [{ sourceType: null }, { sourceType: { not: "availability_request" } }] }, include: { run: true } });
    if (!item || (item.run.kind === "OFFBOARDING" && !canManageOnboarding(actor.membership)) || !canTickChecklistItem(actor.membership, actor.user.id, item, item.run)) return actionError(NOT_ALLOWED);
    await tx.$queryRaw`SELECT "id" FROM "ChecklistRun" WHERE "id"=${item.runId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    if (!await tx.checklistRun.findFirst({ where: { id: item.runId, workspaceId: actor.workspace.id, status: "OPEN" }, select: { id: true } })) return actionError("That checklist has already been completed.");
    await tx.checklistRunItem.update({ where: { id: item.id, run: { workspaceId: actor.workspace.id } }, data: { doneAt: p.data.done ? new Date() : null, doneById: p.data.done ? actor.user.id : null, note: p.data.note || null } });
    await recordAuditEvent({ client: tx, action: "people.checklist_item_updated", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "ChecklistRunItem", targetId: item.id, metadata: { done: p.data.done } });
    return { ok: true };
  });
}
export async function completeChecklist(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ id: idSchema, suspend: z.boolean().default(false) }).safeParse(input); if (!p.success) return validationError(p.error);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ChecklistRun" WHERE "id"=${p.data.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const run = await tx.checklistRun.findFirst({ where: { id: p.data.id, workspaceId: actor.workspace.id, status: "OPEN", items: { none: { sourceType: "availability_request" } } }, include: { items: true } });
    if (!run || (!canManageOnboarding(actor.membership) && (run.subjectUserId !== actor.user.id || run.kind === "OFFBOARDING"))) return actionError(NOT_ALLOWED);
    if (!runProgress(run.items).complete) return actionError("Finish the required items first.");
    if (p.data.suspend) {
      if (run.kind !== "OFFBOARDING" || !canManageOnboarding(actor.membership) || run.subjectUserId === actor.user.id) return actionError(NOT_ALLOWED);
      // Same owner-row lock as the shared membership service, in this transaction.
      await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "workspaceId"=${actor.workspace.id} AND "role"='OWNER' ORDER BY "id" FOR UPDATE`;
      const target = await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: run.subjectUserId ?? "" } });
      if (!target || !canActOnMember(actor.membership, target.role)) return actionError(NOT_ALLOWED);
      if (target.role === "OWNER" && !await tx.membership.count({ where: { workspaceId: actor.workspace.id, role: "OWNER", status: "ACTIVE", id: { not: target.id } } })) return actionError("Keep an active owner before suspending this member.");
      await tx.membership.update({ where: { id: target.id, workspaceId: actor.workspace.id }, data: { status: "SUSPENDED" } });
      await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.offboarding_suspended", targetType: "Membership", targetId: target.id });
    }
    await tx.checklistRun.update({ where: { id: run.id, workspaceId: actor.workspace.id }, data: { status: "DONE", completedAt: new Date() } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.checklist_completed", targetType: "ChecklistRun", targetId: run.id });
    return { ok: true };
  });
}
