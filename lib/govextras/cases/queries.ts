import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { canManageSafeguardingHandlers } from "@/lib/roles";
import type { Actor } from "@/lib/governance/service";
import { dayInZone } from "@/lib/governance/schemas";
import { liveCaseMember, caseAccess, activeHandlers } from "./access";
import { audit } from "./audit";

export async function loadCases(
  actor: Actor,
  filter: {
    q?: string;
    status?: string;
    owner?: string;
    overdue?: string;
    page?: string;
  },
  id?: string,
) {
  const member = await liveCaseMember(actor);
  const handlers = await activeHandlers(actor);
  const appointed = handlers.some((g) => g.userId === actor.user.id);
  const page = Math.max(
    1,
    Math.min(10000, Math.trunc(Number(filter.page) || 1)),
  );
  const requestedNumber = Number(filter.q);
  const caseNumber =
    Number.isSafeInteger(requestedNumber) &&
    requestedNumber > 0 &&
    requestedNumber <= 2147483647
      ? requestedNumber
      : -1;
  const where = {
    workspaceId: actor.workspace.id,
    handlerIds: { has: actor.user.id },
    ...(filter.status ? { status: filter.status.slice(0, 30) } : {}),
    ...(filter.owner
      ? { AND: [{ handlerIds: { has: filter.owner.slice(0, 64) } }] }
      : {}),
    ...(filter.overdue === "1"
      ? {
          closedAt: null,
          dueOn: {
            lt: new Date(dayInZone(new Date(), actor.workspace.timezone)),
          },
        }
      : {}),
    ...(filter.q ? { number: caseNumber } : {}),
  };
  const [rows, total, people, committees, appointments] = await Promise.all([
    appointed
      ? prisma.safeguardingCase.findMany({
          where,
          orderBy: [{ dueOn: "asc" }, { id: "asc" }],
          take: 30,
          skip: (page - 1) * 30,
          select: {
            id: true,
            number: true,
            kind: true,
            status: true,
            dueOn: true,
            receivedOn: true,
            handlerIds: true,
          },
        })
      : [],
    appointed ? prisma.safeguardingCase.count({ where }) : 0,
    prisma.membership.findMany({
      where: {
        workspaceId: actor.workspace.id,
        status: "ACTIVE",
        role: { in: ["MEMBER", "ADMIN", "OWNER"] },
        user: { disabledAt: null },
      },
      select: { user: { select: { id: true, name: true } } },
    }),
    canManageSafeguardingHandlers(member)
      ? prisma.governanceRecord.findMany({
          where: {
            workspaceId: actor.workspace.id,
            kind: "COMMITTEE",
            status: "ACTIVE",
            archivedAt: null,
          },
          select: { id: true, title: true },
        })
      : [],
    canManageSafeguardingHandlers(member)
      ? prisma.safeguardingHandler.findMany({
          where: { workspaceId: actor.workspace.id },
          select: {
            id: true,
            userId: true,
            committeeId: true,
            endsOn: true,
            revokedAt: true,
          },
        })
      : [],
  ]);
  let selected = null;
  if (id) {
    const row = await caseAccess(actor, id);
    const [events, files] = await Promise.all([
      prisma.safeguardingEvent.findMany({
        where: { workspaceId: actor.workspace.id, caseId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      prisma.safeguardingAttachment.findMany({
        where: {
          workspaceId: actor.workspace.id,
          caseId: id,
          file: { deletedAt: null },
        },
        select: {
          file: {
            select: { id: true, filename: true, contentType: true, size: true },
          },
        },
      }),
    ]);
    await audit(actor, prisma, "viewed", id);
    selected = {
      id: row.id,
      number: row.number,
      kind: row.kind,
      status: row.status,
      dueOn: row.dueOn,
      receivedOn: row.receivedOn,
      handlerIds: row.handlerIds,
      closedAt: row.closedAt,
      details: decryptSecret("safeguarding-details", row.detailsEnc),
      events: events.map(({ bodyEnc, ...e }) => ({
        ...e,
        body: decryptSecret("safeguarding-event", bodyEnc),
      })),
      files: files.map((f) => f.file),
    };
  }
  return {
    rows,
    total,
    page,
    selected,
    handlers: handlers.map((h) => ({ userId: h.userId })),
    people,
    committees,
    appointments,
    appointed,
    canAppoint: canManageSafeguardingHandlers(member),
  };
}
export type CaseData = Awaited<ReturnType<typeof loadCases>>;
