import "server-only";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadConflictLinks } from "@/lib/govextras/conflicts";
import { type Section, SECTIONS, sectionFor, dayInZone, governanceFilters } from "../schemas";
import { type Actor, assertActor } from "./access";

export type Filters = {
  q?: string;
  status?: string;
  owner?: string;
  kind?: string;
  overdue?: string;
  page?: string;
  archived?: string;
};
export function recordsWhere(
  workspaceId: string,
  section: Section,
  timezone: string,
  filter: Filters,
): Prisma.GovernanceRecordWhereInput {
  const kinds = SECTIONS[section];
  const kind = kinds.find((k) => k === filter.kind);
  return {
    workspaceId,
    archivedAt: filter.archived === "1" ? { not: null } : null,
    kind: kind ?? { in: [...kinds] },
    ...(filter.q
      ? { title: { contains: filter.q.slice(0, 200), mode: "insensitive" } }
      : {}),
    ...(filter.status ? { status: filter.status.slice(0, 30) } : {}),
    ...(filter.owner ? { ownerId: filter.owner.slice(0, 64) } : {}),
    ...(filter.overdue === "1"
      ? {
          ...(section === "compliance" ? {kind: "OBLIGATION", status: "TODO"} : section === "reviews" ? {status:"DUE"} : {}),
          dueOn: { lt: new Date(dayInZone(new Date(), timezone)) },
        }
      : {}),
  };
}
export async function loadGovernance(
  actor: Actor,
  section: Section,
  filters: Filters,
  edit?: string,
) {
  await assertActor(actor);
  const where = recordsWhere(
    actor.workspace.id,
    section,
    actor.workspace.timezone,
    filters,
  );
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1),
  );
  const [
    records,
    total,
    selected,
    owners,
    committees,
    organisations,
    vendors,
    meetings,
    contacts, docs, obligations, entities, plans, decisions, evidence,
  ] = await Promise.all([
    prisma.governanceRecord.findMany({
      where,
      orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 30,
      skip: (page - 1) * 30,
    }),
    prisma.governanceRecord.count({ where }),
    edit
      ? prisma.governanceRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: edit.slice(0, 64),
            archivedAt: filters.archived === "1" ? { not: null } : null,
          },
          include: {
            attachments: {
              where: { file: { deletedAt: null } },
              include: {
                file: {
                  select: {
                    id: true,
                    filename: true,
                    contentType: true,
                    size: true,
                  },
                },
              },
            },
            bankChanges: {
              select: {
                id: true,
                reason: true,
                actorId: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 50,
            },
          },
        })
      : null,
    prisma.membership.findMany({
      where: {
        workspaceId: actor.workspace.id,
        status: "ACTIVE",
        role: { in: ["ADMIN", "OWNER"] },
        user: { disabledAt: null },
      },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        kind: "COMMITTEE",
        archivedAt: null,
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.organisation.findMany({
      where: { workspaceId: actor.workspace.id, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        kind: "VENDOR",
        archivedAt: null,
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.meeting.findMany({
      where: { workspaceId: actor.workspace.id, status: { not: "CANCELLED" } },
      select: { id: true, title: true },
      orderBy: { startsAt: "desc" },
    }),
    prisma.contact.findMany({
      where: { workspaceId: actor.workspace.id, deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.doc.findMany({where:{workspaceId:actor.workspace.id,archivedAt:null},select:{id:true,title:true},orderBy:{title:"asc"}}),
    prisma.governanceRecord.findMany({where:{workspaceId:actor.workspace.id,kind:"OBLIGATION",archivedAt:null},select:{id:true,title:true}}),
    prisma.governanceRecord.findMany({where:{workspaceId:actor.workspace.id,kind:"LEGAL_ENTITY",archivedAt:null},select:{id:true,title:true}}),
    prisma.governanceRecord.findMany({where:{workspaceId:actor.workspace.id,kind:"EMERGENCY_PLAN",archivedAt:null},select:{id:true,title:true}}),
    prisma.decision.findMany({where:{workspaceId:actor.workspace.id},select:{id:true,title:true},orderBy:{decidedAt:"desc"}}),
    prisma.governanceRecord.findMany({where:{workspaceId:actor.workspace.id,archivedAt:null,kind:{not:"BOARD_PACK"}},select:{id:true,title:true},orderBy:{title:"asc"}}),
  ]);
  return {
    records,
    total,
    page,
    selected:
      selected && sectionFor(selected.kind) === section ? selected : null,
    owners,
    committees,
    organisations,
    vendors,
    meetings,
    contacts, docs, obligations, entities, plans, decisions, evidence,
    conflict: await loadConflictLinks(actor, selected?.kind === "CONFLICT" ? selected.id : undefined),
  };
}
export type GovernanceData = Awaited<ReturnType<typeof loadGovernance>>;
/** One section for its page; an edit id outside it is not found. */
export async function loadGovernanceScreen(
  actor: Actor,
  section: Section,
  params: Record<string, string | string[] | undefined>,
) {
  const edit = typeof params.edit === "string" ? params.edit : undefined;
  const data = await loadGovernance(
    actor,
    section,
    governanceFilters(params),
    edit,
  );
  if (edit && !data.selected) notFound();
  return data;
}
