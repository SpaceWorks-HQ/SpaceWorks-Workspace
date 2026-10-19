import "server-only";

import type { ChecklistKind, MembershipType, Prisma, WorkspaceRole } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { buildRunItems, parseTemplateItems, type AssigneeRule, type RunItemDraft } from "@/lib/people/checklistItems";

/**
 * Starting checklist runs inside the caller's transaction. Used by manual
 * starts (onboarding page), team joins and the invitation-acceptance hook.
 */

type Tx = Prisma.TransactionClient;
type WorkspaceRef = { id: string; slug: string };

const ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "GUEST"];

/** Build a resolver for template assignee rules from the workspace's active members and team leads. */
export async function assigneeResolver(tx: Tx, workspaceId: string, subjectUserId: string | null, templateTeamId: string | null) {
  const [members, leads] = await Promise.all([
    tx.membership.findMany({ where: { workspaceId, status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, select: { userId: true, role: true } }),
    tx.teamMember.findMany({ where: { role: "LEAD", team: { workspaceId, archivedAt: null } }, orderBy: { joinedAt: "asc" }, select: { teamId: true, userId: true } }),
  ]);
  const active = new Set(members.map((m) => m.userId));
  return (rule: AssigneeRule, ref: string | null): string | null => {
    switch (rule) {
      case "SUBJECT":
        return subjectUserId && active.has(subjectUserId) ? subjectUserId : null;
      case "USER":
        return ref && active.has(ref) ? ref : null;
      case "ROLE": {
        const role = ROLES.includes(ref as WorkspaceRole) ? (ref as WorkspaceRole) : "ADMIN";
        // Admin items go to the longest-serving admin (an owner when there is none).
        const match = members.find((m) => m.role === role && m.userId !== subjectUserId) ?? (role === "ADMIN" ? members.find((m) => m.role === "OWNER" && m.userId !== subjectUserId) : undefined);
        return match?.userId ?? null;
      }
      case "TEAM_LEAD": {
        const teamId = ref ?? templateTeamId;
        const lead = leads.find((l) => l.teamId === teamId && l.userId !== subjectUserId && active.has(l.userId));
        return lead?.userId ?? null;
      }
    }
  };
}

export async function createRun(
  tx: Tx,
  input: {
    workspaceId: string;
    kind: ChecklistKind;
    title: string;
    templateId: string | null;
    subjectUserId: string | null;
    actorId: string | null;
    dueAt: Date | null;
    items: RunItemDraft[];
  },
) {
  const run = await tx.checklistRun.create({
    data: {
      workspaceId: input.workspaceId,
      templateId: input.templateId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      subjectUserId: input.subjectUserId,
      createdById: input.actorId,
      dueAt: input.dueAt,
      items: { create: input.items },
    },
    select: { id: true },
  });
  await recordAuditEvent({ client: tx, action: `people.${input.kind === "OFFBOARDING" ? "offboarding" : "checklist"}_started`, workspaceId: input.workspaceId, actorId: input.actorId, targetType: "ChecklistRun", targetId: run.id, metadata: { kind: input.kind, items: input.items.length } });
  await recordActivity({ workspaceId: input.workspaceId, actorId: input.actorId, verb: "started", entityType: "checklist", entityId: run.id, summary: "Started a community checklist", visibility: "PRIVATE" }, tx);
  return run;
}

/** Start one template for a member: resolves assignees and due dates from now. */
export async function startTemplateRun(
  tx: Tx,
  input: { workspaceId: string; template: { id: string; kind: ChecklistKind; name: string; teamId: string | null; items: Prisma.JsonValue }; subjectUserId: string | null; subjectName: string | null; actorId: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  const resolve = await assigneeResolver(tx, input.workspaceId, input.subjectUserId, input.template.teamId);
  const items = buildRunItems(parseTemplateItems(input.template.items), { startAt: now, resolve });
  const lastDue = items.reduce<Date | null>((max, item) => (item.dueAt && (!max || item.dueAt > max) ? item.dueAt : max), null);
  return createRun(tx, {
    workspaceId: input.workspaceId,
    kind: input.template.kind,
    title: input.subjectName ? `${input.template.name}: ${input.subjectName}` : input.template.name,
    templateId: input.template.id,
    subjectUserId: input.subjectUserId,
    actorId: input.actorId,
    dueAt: lastDue,
    items,
  });
}

/**
 * Start every ONBOARDING template set to auto-start for this trigger (a
 * membership type when someone joins, a team id when someone joins a team),
 * unless the member already has an open run from that template. Returns
 * after-commit callbacks (none today; kept so callers stay uniform).
 */
export async function startAutoChecklists(
  tx: Tx,
  input: { workspace: WorkspaceRef; subjectUserId: string; trigger: { teamId: string } | { membershipType: MembershipType }; actorId: string | null; now?: Date },
): Promise<Array<() => Promise<void>>> {
  const key = "teamId" in input.trigger ? input.trigger.teamId : input.trigger.membershipType;
  const templates = await tx.checklistTemplate.findMany({ where: { workspaceId: input.workspace.id, kind: "ONBOARDING", autoStartFor: key }, orderBy: { createdAt: "asc" } });
  if (templates.length === 0) return [];
  const open = new Set(
    (await tx.checklistRun.findMany({ where: { workspaceId: input.workspace.id, subjectUserId: input.subjectUserId, status: "OPEN", templateId: { in: templates.map((t) => t.id) } }, select: { templateId: true } })).map((row) => row.templateId),
  );
  const subject = await tx.user.findUnique({ where: { id: input.subjectUserId }, select: { name: true, email: true } });
  for (const template of templates) {
    if (open.has(template.id)) continue;
    await startTemplateRun(tx, { workspaceId: input.workspace.id, template, subjectUserId: input.subjectUserId, subjectName: subject?.name?.trim() || subject?.email.split("@")[0] || null, actorId: input.actorId, now: input.now });
  }
  return [];
}
