import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { hiddenTeamIds, teamScopeFilter, userTeamIds } from "@/lib/teamAccess";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@helpers-${suffix}.test`;
const slug = `helpers-${suffix}`;
let workspaceId: string;
let owner: string;
let member: string;
let insider: string;

describe.sequential("platform extension helpers", () => {
  beforeAll(async () => {
    owner = (await createUser(`owner${domain}`)).id;
    member = (await createUser(`member${domain}`)).id;
    insider = (await createUser(`insider${domain}`)).id;
    workspaceId = (await createWorkspace(slug, owner)).id;
    await addMember(workspaceId, member, "MEMBER");
    await addMember(workspaceId, insider, "MEMBER");
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("hides private teams' channels from non-members but not from admins", async () => {
    const infra = await prisma.team.create({ data: { workspaceId, name: "Infra", slug: "infra", visibility: "PRIVATE", members: { create: { userId: insider, role: "LEAD" } } } });
    await prisma.team.create({ data: { workspaceId, name: "Events", slug: "events" } });
    await prisma.channel.create({ data: { workspaceId, name: "infra", slug: "infra", teamId: infra.id } });

    expect(await userTeamIds(workspaceId, insider)).toEqual([infra.id]);
    expect(await hiddenTeamIds(workspaceId, { userId: owner, role: "OWNER" })).toEqual([]);
    expect(await hiddenTeamIds(workspaceId, { userId: insider, role: "MEMBER" })).toEqual([]);
    const hidden = await hiddenTeamIds(workspaceId, { userId: member, role: "MEMBER" });
    expect(hidden).toEqual([infra.id]);

    const visibleToMember = await prisma.channel.findMany({ where: { workspaceId, ...teamScopeFilter(hidden) }, select: { slug: true } });
    expect(visibleToMember.map((channel) => channel.slug)).not.toContain("infra");
    expect(visibleToMember.map((channel) => channel.slug)).toContain("general");
  });

  it("indexes, finds by full text and trigram, and removes search documents", async () => {
    await indexSearchDocument({ workspaceId, entityType: "contact", entityId: "c_1", title: "Kerala Startup Mission", body: "Sponsor for the hardware hackathon", url: `/w/${slug}/contacts/c_1` });
    await indexSearchDocument({ workspaceId, entityType: "contact", entityId: "c_1", title: "Kerala Startup Mission", body: "Sponsor for the hardware hackathon and build nights", url: `/w/${slug}/contacts/c_1` });
    const fullText = await prisma.$queryRaw<{ entityId: string }[]>`
      SELECT "entityId" FROM "SearchDocument"
      WHERE "workspaceId" = ${workspaceId} AND "searchVector" @@ websearch_to_tsquery('simple', ${"hackathon"})`;
    expect(fullText.map((row) => row.entityId)).toEqual(["c_1"]);
    const fuzzy = await prisma.$queryRaw<{ entityId: string }[]>`
      SELECT "entityId" FROM "SearchDocument" WHERE "workspaceId" = ${workspaceId} AND "title" % ${"Kerala Startup Misson"}`;
    expect(fuzzy.map((row) => row.entityId)).toEqual(["c_1"]);
    expect(await prisma.searchDocument.count({ where: { workspaceId } })).toBe(1);
    await removeSearchDocument("contact", "c_1");
    expect(await prisma.searchDocument.count({ where: { workspaceId } })).toBe(0);
  });

  it("records activity events", async () => {
    await recordActivity({ workspaceId, actorId: owner, verb: "created", entityType: "team", entityId: "t1", summary: "Created the Infra team" });
    expect(await prisma.activityEvent.findFirst({ where: { workspaceId, entityId: "t1" } })).toMatchObject({ verb: "created", visibility: "WORKSPACE" });
  });

  it("cascades every extension row when the workspace is deleted", async () => {
    const other = `${slug}-gone`;
    const ws = await createWorkspace(other, owner);
    await prisma.monitor.create({ data: { workspaceId: ws.id, name: "Site", type: "HTTP", checks: { create: { workspaceId: ws.id, status: "UP" } } } });
    await prisma.vaultItem.create({ data: { workspaceId: ws.id, type: "LOGIN", title: "Router", secretEnc: "v1.x", dataKeyEnc: "v1.y", ownerId: owner } });
    await prisma.notificationEventRecord.create({ data: { workspaceId: ws.id, type: "monitor.down", severity: "CRITICAL", title: "Down", payload: {} } });
    await prisma.workspace.delete({ where: { id: ws.id } });
    expect(await prisma.monitor.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await prisma.monitorCheck.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await prisma.vaultItem.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: ws.id } })).toBe(0);
  });
});
