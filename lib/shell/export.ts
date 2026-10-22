import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { EXPORT_FIELDS, redactExportRow } from "./export/fields";

export async function buildWorkspaceExport(
  workspaceId: string,
  includeMessages = false,
  client: DbClient = prisma,
) {
  const entities: Record<string, unknown[]> = {};
  for (const [model, fields] of Object.entries(EXPORT_FIELDS)) {
    const selected = Prisma.join(
      fields.map((field) => Prisma.raw(`"${field}"`)),
    );
    const rows = await client.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`SELECT ${selected} FROM ${Prisma.raw(`"${model}"`)} WHERE ${Prisma.raw(model === "Workspace" ? '"id"' : '"workspaceId"')}=${workspaceId} ${model === "LedgerEntry" ? Prisma.sql`AND "privatePayroll" = false` : model === "FileObject" ? Prisma.sql`AND "folder" NOT LIKE '/safeguarding%' AND NOT EXISTS (SELECT 1 FROM "SafeguardingAttachment" sa WHERE sa."workspaceId"=${workspaceId} AND sa."fileId"="FileObject".id) AND "folder" NOT LIKE '/finance-tools%' AND NOT EXISTS (SELECT 1 FROM "FinanceAttachment" a WHERE a."workspaceId"=${workspaceId} AND a."fileId"="FileObject".id)` : Prisma.empty} LIMIT 100001`,
    );
    if (rows.length > 100000) throw new Error("Export exceeds supported size");
    entities[model] = rows.map((row) => redactExportRow(model, row));
  }
  const children: Array<[string, string, string, string[]]> = [
    [
      "BoardColumn",
      "Project",
      "projectId",
      ["id", "projectId", "name", "position", "category"],
    ],
    ["TaskAssignee", "Task", "taskId", ["taskId", "userId", "assignedAt"]],
    ["TaskLabel", "Task", "taskId", ["taskId", "labelId"]],
    [
      "TaskComment",
      "Task",
      "taskId",
      ["id", "taskId", "authorId", "body", "createdAt", "deletedAt"],
    ],
    [
      "TaskActivity",
      "Task",
      "taskId",
      ["id", "taskId", "actorId", "kind", "createdAt"],
    ],
    [
      "DocRevision",
      "Doc",
      "docId",
      ["id", "docId", "title", "contentHtml", "authorId", "createdAt"],
    ],
    [
      "FileVersion",
      "FileObject",
      "fileId",
      ["id", "fileId", "version", "size", "contentType", "createdAt"],
    ],
    ["TeamMember", "Team", "teamId", ["teamId", "userId", "role", "joinedAt"]],
    [
      "ShiftAssignment",
      "Shift",
      "shiftId",
      ["id", "shiftId", "userId", "status", "checkedInAt", "hoursCenti"],
    ],
    [
      "KeyResult",
      "Goal",
      "goalId",
      ["id", "goalId", "title", "metricType", "start", "target", "current"],
    ],
    [
      "MeetingAttendee",
      "Meeting",
      "meetingId",
      ["id", "meetingId", "userId", "contactId", "rsvp", "attended"],
    ],
    [
      "AgendaItem",
      "Meeting",
      "meetingId",
      [
        "id",
        "meetingId",
        "title",
        "ownerId",
        "durationMin",
        "notesMd",
        "status",
        "sortOrder",
      ],
    ],
  ];
  for (const [model, parent, foreignKey, fields] of children) {
    const selected = Prisma.join(
      fields.map((field) => Prisma.raw(`c."${field}"`)),
    );
    const rows = await client.$queryRaw<unknown[]>(
      Prisma.sql`SELECT ${selected} FROM ${Prisma.raw(`"${model}"`)} c JOIN ${Prisma.raw(`"${parent}"`)} p ON p.id=${Prisma.raw(`c."${foreignKey}"`)} WHERE p."workspaceId"=${workspaceId} LIMIT 100001`,
    );
    if (rows.length > 100000) throw new Error("Export exceeds supported size");
    entities[model] = rows;
  }
  // Direct and private channel messages are excluded, including when messages are requested.
  if (includeMessages)
    entities.Message =
      await client.$queryRaw`SELECT m.id,m."channelId",m."authorId",m.body,m."createdAt" FROM "Message" m JOIN "Channel" c ON c.id=m."channelId" WHERE m."workspaceId"=${workspaceId} AND c."workspaceId"=${workspaceId} AND c.kind='PUBLIC' AND c."teamId" IS NULL AND m."deletedAt" IS NULL LIMIT 100000`;
  return {
    version: 1,
    workspaceId,
    exportedAt: new Date().toISOString(),
    excluded: [
      "Secrets and credentials",
      "Account and identity links",
      "Vault contents",
      "Emergency contacts",
      "Private conversations",
      "File binaries",
    ],
    entities,
  };
}

export { EXPORT_FIELDS, redactExportRow } from "./export/fields";
