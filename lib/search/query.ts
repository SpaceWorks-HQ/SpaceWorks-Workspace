import "server-only";

import { Prisma, type WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";

export type SearchActor = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};
export type SearchHit = {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  url: string;
  rank: number;
};
export function normaliseSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 200);
}

/** All identifiers come from the static registry below; user text is bound as parameters. */
export function accessSql(actor: SearchActor) {
  const admin = hasRoleAtLeast(actor.role, "ADMIN");
  const member = hasRoleAtLeast(actor.role, "MEMBER");
  const team = (column: Prisma.Sql) => Prisma.sql`(${column} IS NULL OR EXISTS (
    SELECT 1 FROM "Team" t WHERE t.id = ${column} AND t."workspaceId" = ${actor.workspaceId}
    AND (${admin} OR t.visibility = 'PUBLIC' OR EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId"=t.id AND tm."userId"=${actor.userId}))))`;
  const visible = Prisma.sql`(r.visibility = 'WORKSPACE' OR ${admin} OR (r.visibility = 'PRIVATE' AND r."ownerId"=${actor.userId}) OR (r.visibility = 'TEAM' AND EXISTS (SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id=tm."teamId" WHERE t."workspaceId"=${actor.workspaceId} AND tm."teamId"=r."teamId" AND tm."userId"=${actor.userId})))`;
  const channel = Prisma.sql`EXISTS (SELECT 1 FROM "Channel" c WHERE c.id=r."channelId" AND c."workspaceId"=${actor.workspaceId} AND c."archivedAt" IS NULL AND ${team(Prisma.sql`c."teamId"`)} AND ((${member} AND c.kind='PUBLIC') OR EXISTS (SELECT 1 FROM "ChannelMember" cm WHERE cm."channelId"=c.id AND cm."userId"=${actor.userId})))`;
  const project = Prisma.sql`(r."projectId" IS NULL OR EXISTS (SELECT 1 FROM "Project" p WHERE p.id=r."projectId" AND p."workspaceId"=${actor.workspaceId} AND p.status <> 'ARCHIVED' AND ${team(Prisma.sql`p."teamId"`)}))`;
  const registry: Array<[string, string, Prisma.Sql]> = [
    [
      "task",
      "Task",
      Prisma.sql`r."archivedAt" IS NULL AND (r."projectId" IS NOT NULL OR ${member}) AND ${project}`,
    ],
    [
      "project",
      "Project",
      Prisma.sql`r.status <> 'ARCHIVED' AND ${team(Prisma.sql`r."teamId"`)}`,
    ],
    [
      "doc",
      "Doc",
      Prisma.sql`r."archivedAt" IS NULL AND (r.visibility='WORKSPACE' OR ${admin})`,
    ],
    ["message", "Message", Prisma.sql`r."deletedAt" IS NULL AND ${channel}`],
    [
      "channel",
      "Channel",
      Prisma.sql`r."archivedAt" IS NULL AND ${team(Prisma.sql`r."teamId"`)} AND ((${member} AND r.kind='PUBLIC') OR EXISTS (SELECT 1 FROM "ChannelMember" cm WHERE cm."channelId"=r.id AND cm."userId"=${actor.userId}))`,
    ],
    [
      "announcement",
      "Announcement",
      Prisma.sql`r."publishedAt" <= CURRENT_TIMESTAMP`,
    ],
    ["community_event", "CommunityEvent", Prisma.sql`r."cancelledAt" IS NULL`],
    ["shoutout", "Shoutout", Prisma.sql`TRUE`],
    ["link", "LinkItem", team(Prisma.sql`r."teamId"`)],
    ["monitor", "Monitor", Prisma.sql`${member} AND ${project}`],
    [
      "service",
      "ServiceCatalogItem",
      Prisma.sql`${member} AND ${team(Prisma.sql`r."teamId"`)}`,
    ],
    ["app_review", "AppReview", Prisma.sql`${member}`],
    // Personal notepad: the owner only, never admins.
    ["note", "PersonalNote", Prisma.sql`r."archivedAt" IS NULL AND r."userId"=${actor.userId}`],
    ["incident", "Incident", Prisma.sql`${member}`],
    ["asset", "Asset", Prisma.sql`${member}`],
    [
      "subscription",
      "Subscription",
      Prisma.sql`${member} AND ${team(Prisma.sql`r."teamId"`)}`,
    ],
    [
      "contact",
      "Contact",
      Prisma.sql`${member} AND r."deletedAt" IS NULL AND ${visible} AND ${team(Prisma.sql`r."teamId"`)}`,
    ],
    [
      "organisation",
      "Organisation",
      Prisma.sql`${member} AND r."deletedAt" IS NULL AND ${visible} AND ${team(Prisma.sql`r."teamId"`)}`,
    ],
    [
      "meeting",
      "Meeting",
      Prisma.sql`r.status <> 'CANCELLED' AND ${team(Prisma.sql`r."teamId"`)} AND (${admin} OR r.visibility='WORKSPACE' OR r."createdById"=${actor.userId} OR (r.visibility='TEAM' AND EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId"=r."teamId" AND tm."userId"=${actor.userId})))`,
    ],
    [
      "decision",
      "Decision",
      Prisma.sql`${team(Prisma.sql`r."teamId"`)} AND (${admin} OR r.visibility='WORKSPACE' OR r."createdById"=${actor.userId} OR (r.visibility='TEAM' AND EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId"=r."teamId" AND tm."userId"=${actor.userId}))) AND (r."meetingId" IS NULL OR EXISTS (SELECT 1 FROM "Meeting" mt WHERE mt.id=r."meetingId" AND mt."workspaceId"=${actor.workspaceId} AND ${team(Prisma.sql`mt."teamId"`)} AND (${admin} OR mt.visibility='WORKSPACE' OR mt."createdById"=${actor.userId} OR (mt.visibility='TEAM' AND EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId"=mt."teamId" AND tm."userId"=${actor.userId})))))`,
    ],
    ["goal", "Goal", Prisma.sql`${member} AND ${team(Prisma.sql`r."teamId"`)}`],
    [
      "cycle",
      "Cycle",
      Prisma.sql`${member} AND ${team(Prisma.sql`r."teamId"`)} AND ${project}`,
    ],
    ["idea", "Idea", Prisma.sql`${member}`],
    [
      "changelog",
      "ChangelogEntry",
      Prisma.sql`${member} AND r."publishedAt" <= CURRENT_TIMESTAMP`,
    ],
    ["form", "Form", Prisma.sql`${member} AND ${team(Prisma.sql`r."teamId"`)}`],
    [
      "template",
      "Template",
      Prisma.sql`${member} AND ${team(Prisma.sql`r."teamId"`)} AND (${admin} OR r.scope='WORKSPACE' OR r."createdById"=${actor.userId} OR (r.scope='TEAM' AND EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId"=r."teamId" AND tm."userId"=${actor.userId})))`,
    ],
    [
      "poll",
      "Poll",
      Prisma.sql`${member} AND (r."channelId" IS NULL OR ${channel}) AND (${admin} OR r."createdById"=${actor.userId} OR r.eligibility->>'type'='ALL_MEMBERS' OR (r.eligibility->>'type'='TEAM' AND EXISTS (SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id=tm."teamId" WHERE t."workspaceId"=${actor.workspaceId} AND tm."teamId"=r.eligibility->>'ref' AND tm."userId"=${actor.userId})) OR (r.eligibility->>'type'='LIST' AND (r.eligibility->'ref') ? ${actor.userId})) AND (r."meetingId" IS NULL OR EXISTS (SELECT 1 FROM "Meeting" mt WHERE mt.id=r."meetingId" AND mt."workspaceId"=${actor.workspaceId} AND ${team(Prisma.sql`mt."teamId"`)} AND (${admin} OR mt.visibility='WORKSPACE' OR mt."createdById"=${actor.userId} OR EXISTS (SELECT 1 FROM "MeetingAttendee" ma WHERE ma."meetingId"=mt.id AND ma."userId"=${actor.userId}))))`,
    ],
    [
      "invoice",
      "Invoice",
      Prisma.sql`${member} AND (${admin} OR EXISTS (SELECT 1 FROM "Workspace" w WHERE w.id=${actor.workspaceId} AND w."financeVisibleToMembers"))`,
    ],
    ["blog_post", "BlogPost", Prisma.sql`${admin}`],
    [
      "file",
      "FileObject",
      Prisma.sql`r."deletedAt" IS NULL AND (r."docId" IS NULL OR EXISTS (SELECT 1 FROM "Doc" doc WHERE doc.id=r."docId" AND doc."workspaceId"=${actor.workspaceId} AND doc."archivedAt" IS NULL AND (doc.visibility='WORKSPACE' OR ${admin}))) AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" le JOIN "Workspace" w ON w.id=le."workspaceId" WHERE le."receiptFileId"=r.id AND NOT (${admin} OR (${member} AND w."financeVisibleToMembers"))) AND (r."taskId" IS NULL OR EXISTS (SELECT 1 FROM "Task" task LEFT JOIN "Project" p ON p.id=task."projectId" WHERE task.id=r."taskId" AND task."workspaceId"=${actor.workspaceId} AND task."archivedAt" IS NULL AND ${team(Prisma.sql`p."teamId"`)})) AND NOT EXISTS (SELECT 1 FROM "MessageAttachment" ma JOIN "Message" m ON m.id=ma."messageId" JOIN "Channel" c ON c.id=m."channelId" WHERE ma."fileId"=r.id AND (m."workspaceId"<>${actor.workspaceId} OR c."workspaceId"<>${actor.workspaceId} OR c."archivedAt" IS NOT NULL OR m."deletedAt" IS NOT NULL OR NOT (${team(Prisma.sql`c."teamId"`)} AND ((${member} AND c.kind='PUBLIC') OR EXISTS (SELECT 1 FROM "ChannelMember" cm WHERE cm."channelId"=c.id AND cm."userId"=${actor.userId})))))`,
    ],
  ];
  const live = registry.map(
    ([kind, table, check]) =>
      Prisma.sql`(d."entityType"=${kind} AND EXISTS (SELECT 1 FROM ${Prisma.raw(`"${table}"`)} r WHERE r.id=d."entityId" AND r."workspaceId"=${actor.workspaceId} AND ${check}))`,
  );
  return Prisma.sql`d."workspaceId"=${actor.workspaceId}
    AND EXISTS (SELECT 1 FROM "Membership" mem JOIN "Workspace" w ON w.id=mem."workspaceId" JOIN "User" u ON u.id=mem."userId" WHERE mem."workspaceId"=${actor.workspaceId} AND mem."userId"=${actor.userId} AND mem.status='ACTIVE' AND mem.role::text=${actor.role} AND w."archivedAt" IS NULL AND u."disabledAt" IS NULL)
    AND ${team(Prisma.sql`d."teamId"`)}
    AND (d."entityType"<>'note' OR d."ownerId"=${actor.userId})
    AND (d.visibility='WORKSPACE' OR (d."entityType"='app_review' AND ${member}) OR ${admin} OR (d.visibility='PRIVATE' AND d."ownerId"=${actor.userId}) OR (d.visibility='TEAM' AND EXISTS (SELECT 1 FROM "TeamMember" tm JOIN "Team" t ON t.id=tm."teamId" WHERE t."workspaceId"=${actor.workspaceId} AND tm."teamId"=d."teamId" AND tm."userId"=${actor.userId})))
    AND (d."projectId" IS NULL OR EXISTS (SELECT 1 FROM "Project" p WHERE p.id=d."projectId" AND p."workspaceId"=${actor.workspaceId} AND ${team(Prisma.sql`p."teamId"`)}))
    AND (d."channelId" IS NULL OR EXISTS (SELECT 1 FROM "Channel" c WHERE c.id=d."channelId" AND c."workspaceId"=${actor.workspaceId} AND c."archivedAt" IS NULL AND ${team(Prisma.sql`c."teamId"`)} AND ((${member} AND c.kind='PUBLIC') OR EXISTS (SELECT 1 FROM "ChannelMember" cm WHERE cm."channelId"=c.id AND cm."userId"=${actor.userId}))))
    AND (${Prisma.join(live, " OR ")})`;
}

export function buildSearchQuery(
  actor: SearchActor,
  input: string,
  type?: string,
  offset = 0,
) {
  const query = normaliseSearch(input);
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return Prisma.sql`SELECT d.id, d."entityType", d."entityId", d.title, d.url,
    (ts_rank(d."searchVector", websearch_to_tsquery('simple', ${query})) + similarity(d.title, ${query}))::float8 AS rank
    FROM "SearchDocument" d WHERE ${accessSql(actor)} AND (${type ? Prisma.sql`d."entityType"=${type}` : Prisma.sql`TRUE`})
    AND (d."searchVector" @@ websearch_to_tsquery('simple', ${query}) OR d.title ILIKE ${pattern} OR similarity(d.title, ${query}) > 0.2)
    ORDER BY rank DESC, d."updatedAt" DESC, d.id LIMIT 50 OFFSET ${Math.max(0, Math.min(offset, 500))}`;
}
export async function searchDocuments(
  actor: SearchActor,
  query: string,
  type?: string,
  offset = 0,
  client: DbClient = prisma,
): Promise<SearchHit[]> {
  if (!normaliseSearch(query)) return [];
  const rows = await client.$queryRaw<SearchHit[]>(
    buildSearchQuery(actor, query, type, offset),
  );
  return rows.filter(
    (row) => row.url.startsWith("/w/") && !/[\\\r\n]/.test(row.url),
  );
}
export async function listActivity(
  actor: SearchActor,
  before?: Date,
  type?: string,
) {
  return prisma.$queryRaw<
    Array<{ id: string; summary: string; entityType: string; createdAt: Date }>
  >`SELECT d.id, d.summary, d."entityType", d."createdAt" FROM (SELECT a.*, a."actorId" AS "ownerId", NULL::text AS "channelId" FROM "ActivityEvent" a) d WHERE ${accessSql(actor)} AND ${before ? Prisma.sql`d."createdAt" < ${before}` : Prisma.sql`TRUE`} AND ${type ? Prisma.sql`d."entityType"=${type}` : Prisma.sql`TRUE`} ORDER BY d."createdAt" DESC, d.id DESC LIMIT 40`;
}

/** Authorise a polymorphic resource without trusting index metadata or requiring an index row. */
export async function canAccessResource(
  actor: SearchActor,
  type: string,
  id: string,
  client: DbClient = prisma,
) {
  const rows = await client.$queryRaw<
    Array<{ ok: number }>
  >`SELECT 1 AS ok FROM (SELECT ${actor.workspaceId}::text AS "workspaceId",${type}::text AS "entityType",${id}::text AS "entityId",'WORKSPACE'::"Visibility" AS visibility,NULL::text AS "teamId",NULL::text AS "projectId",NULL::text AS "channelId",NULL::text AS "ownerId") d WHERE ${accessSql(actor)}`;
  return rows.length > 0;
}
