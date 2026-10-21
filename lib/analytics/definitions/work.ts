import "server-only";
import type { DefinitionRegistry } from "./registry";
import { task, product } from "./sources";

export function registerWork({ add }: DefinitionRegistry) {
  add(
    "tasks-created",
    "work",
    "Tasks created",
    "Visible, non-archived tasks created in the period.",
    { ...task, label: "coalesce(p.name,'Personal tasks')", chart: "line" },
  );
  add(
    "tasks-completed",
    "work",
    "Tasks completed",
    "Visible tasks completed in the period. Current completion state; reopened tasks are excluded.",
    {
      ...task,
      date: 'r."completedAt"',
      label: "coalesce(p.name,'Personal tasks')",
      chart: "line",
    },
  );
  add(
    "overdue-tasks",
    "work",
    "Overdue tasks",
    "Open tasks overdue at the report end; current state, not historical state reconstruction.",
    {
      ...task,
      date: 'r."dueAt"',
      snapshot: true,
      where: `${task.where} AND r."completedAt" IS NULL AND r."dueAt" IS NOT NULL`,
      label: "r.priority::text",
    },
  );
  add(
    "blockers",
    "work",
    "Blocker age",
    "Age since task creation for currently blocked tasks. The schema has no blocker-start timestamp; task age is explicitly a proxy.",
    {
      ...task,
      snapshot: true,
      label: "ageing",
      value: "0",
      unit: "days",
      mode: "average",
      base: "1",
      where: `${task.where} AND r."completedAt" IS NULL AND (nullif(r."blockerReason",'') IS NOT NULL OR EXISTS(SELECT 1 FROM "TaskDependency" td JOIN "Task" bt ON bt.id=td."blockingTaskId" AND bt."workspaceId"=td."workspaceId" WHERE td."workspaceId"=r."workspaceId" AND td."blockedTaskId"=r.id AND td.type='BLOCKS' AND bt."completedAt" IS NULL AND bt."archivedAt" IS NULL))`,
    },
  );
  add(
    "project-health",
    "work",
    "Project health",
    "Latest check-in at the report end. Projects without a check-in are labelled Not recorded.",
    {
      table: '"Project" r',
      date: 'r."createdAt"',
      titleSql: "r.name",
      path: "'/projects/'||r.key",
      snapshot: true,
      where: "r.status IN ('ACTIVE','PAUSED')",
      label: "health",
      permission: "project",
      dimensions: { team: 'r."teamId"', project: "r.id" },
    },
  );
  add(
    "milestones",
    "work",
    "Milestone completion rate",
    "Milestones due in the period, complete manually or when every linked task is complete. Target dates are not actual completion timestamps, so this does not claim an on-time hit rate.",
    {
      table: '"ProjectMilestone" r',
      join: 'JOIN "Project" p ON p.id=r."projectId" AND p."workspaceId"=r."workspaceId"',
      date: 'r."targetOn"',
      dateOnly: true,
      titleSql: "r.name",
      path: "'/projects/'||p.key||'/overview'",
      label: "p.name",
      value:
        'CASE WHEN r.status=\'DONE\' OR (EXISTS(SELECT 1 FROM "ProjectMilestoneTask" mt WHERE mt."workspaceId"=r."workspaceId" AND mt."milestoneId"=r.id) AND NOT EXISTS(SELECT 1 FROM "ProjectMilestoneTask" mt JOIN "Task" t ON t.id=mt."taskId" AND t."workspaceId"=mt."workspaceId" WHERE mt."workspaceId"=r."workspaceId" AND mt."milestoneId"=r.id AND t."completedAt" IS NULL)) THEN 1 ELSE 0 END',
      base: "1",
      unit: "percent",
      mode: "rate",
      permission: "project",
      dimensions: { project: 'r."projectId"', team: 'p."teamId"' },
    },
  );
  add(
    "releases",
    "work",
    "Releases shipped",
    "Shipped date of recorded releases; no external connector.",
    {
      ...product,
      date: 'r."shippedAt"',
      where: `${product.where} AND r.kind='RELEASE' AND r.status='SHIPPED'`,
      label: "coalesce(p.name,'Unassigned')",
      chart: "line",
    },
  );
  add(
    "bugs-opened",
    "work",
    "Bugs opened by severity",
    "Bug records created in the period.",
    {
      ...product,
      where: `${product.where} AND r.kind='ISSUE' AND r.details->>'type'='BUG'`,
      label: "coalesce(r.details->>'severity','Not recorded')",
    },
  );
  add(
    "bugs-closed",
    "work",
    "Bugs currently resolved",
    "Resolved or closed bugs last updated in the period. No separate resolution timestamp exists; this is an update-date proxy.",
    {
      ...product,
      date: 'r."updatedAt"',
      where: `${product.where} AND r.kind='ISSUE' AND r.details->>'type'='BUG' AND r.status IN ('RESOLVED','CLOSED')`,
      label: "coalesce(r.details->>'severity','Not recorded')",
    },
  );
  add(
    "meeting-load",
    "work",
    "Meeting hours",
    "Scheduled duration of visible, non-cancelled meetings, not attendee-hours.",
    {
      table: '"Meeting" r',
      date: 'r."startsAt"',
      titleSql: "r.title",
      path: "'/meetings/'||r.id",
      where: "r.status<>'CANCELLED' AND r.\"endsAt\" IS NOT NULL",
      value: 'greatest(0,extract(epoch from(r."endsAt"-r."startsAt"))/3600)',
      label: "'Meeting hours'",
      unit: "hours",
      permission: "meeting",
      dimensions: { team: 'r."teamId"', project: 'r."projectId"' },
    },
  );
}
