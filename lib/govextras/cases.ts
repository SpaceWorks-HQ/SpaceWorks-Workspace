import "server-only";
import { prisma, type Tx } from "@/lib/db";
import {
  canContribute,
  canHandleSafeguarding,
  canManageSafeguardingHandlers,
} from "@/lib/roles";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { recordAuditEvent } from "@/lib/audit";
import { nextWorkspaceSequence } from "@/lib/counters";
import {
  uploadWorkspaceFile,
  deleteObjects,
  RASTER_IMAGE_TYPES,
} from "@/lib/storage";
import { GovernanceError, type Actor } from "@/lib/governance/service";
import { dayInZone } from "@/lib/governance/schemas";
import {
  appointmentSchema,
  caseSchema,
  eventSchema,
  caseStatuses,
} from "./rules";
import { z } from "zod";

export async function liveCaseMember(actor: Actor, tx: Tx = prisma) {
  const member = await tx.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
  });
  if (!member || !canContribute(member))
    throw new GovernanceError("You don't have access to do that.");
  return member;
}
export async function caseLock(actor: Actor, tx: Tx) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
  return liveCaseMember(actor, tx);
}
export function activeHandlerWhere(
  workspaceId: string,
  timezone: string,
  now = new Date(),
) {
  return {
    workspaceId,
    revokedAt: null,
    endsOn: { gte: new Date(dayInZone(now, timezone)) },
  };
}
export async function activeHandlers(
  actor: Actor,
  tx: Tx = prisma,
  now = new Date(),
) {
  const [grants, members, committees] = await Promise.all([
    tx.safeguardingHandler.findMany({
      where: activeHandlerWhere(
        actor.workspace.id,
        actor.workspace.timezone,
        now,
      ),
    }),
    tx.membership.findMany({
      where: {
        workspaceId: actor.workspace.id,
        status: "ACTIVE",
        role: { in: ["MEMBER", "ADMIN", "OWNER"] },
        user: { disabledAt: null },
      },
      select: { userId: true },
    }),
    tx.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        kind: "COMMITTEE",
        status: "ACTIVE",
        archivedAt: null,
      },
      select: { id: true },
    }),
  ]);
  return grants.filter(
    (g) =>
      members.some((m) => m.userId === g.userId) &&
      committees.some((c) => c.id === g.committeeId),
  );
}
export async function caseAccess(
  actor: Actor,
  caseId: string,
  tx: Tx = prisma,
) {
  const member = await liveCaseMember(actor, tx);
  const row = await tx.safeguardingCase.findFirst({
    where: { workspaceId: actor.workspace.id, id: caseId },
  });
  const grants = await activeHandlers(actor, tx);
  if (
    !row ||
    !canHandleSafeguarding(
      member,
      grants.some((g) => g.userId === actor.user.id),
      row.handlerIds.includes(actor.user.id),
    )
  )
    throw new GovernanceError(
      "That case is unavailable. Contact its designated handler.",
    );
  return row;
}
async function audit(actor: Actor, tx: Tx, action: string, id?: string) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `safeguarding.${action}`,
    targetType: "safeguarding",
    targetId: id,
    client: tx,
  });
}
export async function appointHandler(actor: Actor, raw: unknown) {
  const input = appointmentSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const member = await caseLock(actor, tx);
    if (!canManageSafeguardingHandlers(member))
      throw new GovernanceError(
        "Only an owner can record committee appointments.",
      );
    if (input.revoke) {
      await tx.safeguardingHandler.updateMany({
        where: { workspaceId: actor.workspace.id, userId: input.userId },
        data: { revokedAt: new Date() },
      });
    } else {
      const eligible = await tx.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: input.userId,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN", "MEMBER"] },
          user: { disabledAt: null },
        },
      });
      const committee = await tx.governanceRecord.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: input.committeeId,
          kind: "COMMITTEE",
          status: "ACTIVE",
          archivedAt: null,
        },
      });
      if (
        !eligible ||
        !committee ||
        input.endsOn < dayInZone(new Date(), actor.workspace.timezone)
      )
        throw new GovernanceError(
          "Choose an active member, committee and current appointment end date.",
        );
      await tx.safeguardingHandler.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: actor.workspace.id,
            userId: input.userId,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          userId: input.userId,
          committeeId: input.committeeId,
          endsOn: new Date(input.endsOn),
          appointedById: actor.user.id,
        },
        update: {
          committeeId: input.committeeId,
          endsOn: new Date(input.endsOn),
          appointedById: actor.user.id,
          revokedAt: null,
        },
      });
    }
    await audit(
      actor,
      tx,
      input.revoke ? "handler_revoked" : "handler_appointed",
      input.userId,
    );
  });
}
export async function createCase(actor: Actor, raw: unknown) {
  const input = caseSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const grants = await activeHandlers(actor, tx);
    const ids = [...new Set(input.handlerIds)];
    if (
      !ids.includes(actor.user.id) ||
      ids.some((id) => !grants.some((g) => g.userId === id))
    )
      throw new GovernanceError(
        "Cases must include you and currently appointed committee handlers.",
      );
    const row = await tx.safeguardingCase.create({
      data: {
        workspaceId: actor.workspace.id,
        number: await nextWorkspaceSequence(
          tx,
          actor.workspace.id,
          "safeguarding",
        ),
        kind: input.kind,
        handlerIds: ids,
        receivedOn: new Date(input.receivedOn),
        dueOn: new Date(input.dueOn),
        detailsEnc: encryptSecret("safeguarding-details", input.details),
        createdById: actor.user.id,
      },
    });
    await audit(actor, tx, "created", row.id);
    return { id: row.id };
  });
}
export async function addCaseEvent(actor: Actor, raw: unknown) {
  const input = eventSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const row = await caseAccess(actor, input.caseId, tx);
    if (row.closedAt)
      throw new GovernanceError(
        "This case is closed. Retain its outcome and create a new case for further concerns.",
      );
    if (input.kind === "ACTION") {
      const handlers = await activeHandlers(actor, tx);
      if (
        !row.handlerIds.includes(input.ownerId) ||
        !handlers.some((h) => h.userId === input.ownerId)
      )
        throw new GovernanceError("Choose a designated handler on this case.");
    }
    await tx.safeguardingEvent.create({
      data: {
        workspaceId: actor.workspace.id,
        caseId: row.id,
        kind: input.kind,
        bodyEnc: encryptSecret("safeguarding-event", input.body),
        ownerId: input.kind === "ACTION" ? input.ownerId : null,
        dueOn: input.kind === "ACTION" && input.dueOn ? new Date(input.dueOn) : null,
        actorId: actor.user.id,
      },
    });
    await audit(actor, tx, "timeline_added", row.id);
  });
}
export async function updateCase(actor: Actor, raw: unknown) {
  const input = z
    .object({
      caseId: z.string().min(1).max(64),
      status: z.enum(caseStatuses),
      dueOn: z.string().optional(),
      handlerIds: z.array(z.string().min(1).max(64)).min(1).max(12).optional(),
    })
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const row = await caseAccess(actor, input.caseId, tx);
    if (row.closedAt)
      throw new GovernanceError("Closed case records are locked.");
    if (input.status === "CLOSED") {
      if (
        (await tx.safeguardingEvent.count({
          where: {
            workspaceId: actor.workspace.id,
            caseId: row.id,
            kind: "ACTION",
            completedAt: null,
          },
        })) ||
        !(await tx.safeguardingEvent.count({
          where: {
            workspaceId: actor.workspace.id,
            caseId: row.id,
            kind: "OUTCOME",
          },
        }))
      )
        throw new GovernanceError(
          "Complete every action and record an outcome before closing.",
        );
    }
    if (input.handlerIds) {
      const grants = await activeHandlers(actor, tx);
      if (
        !input.handlerIds.includes(actor.user.id) ||
        input.handlerIds.some((id) => !grants.some((g) => g.userId === id))
      )
        throw new GovernanceError(
          "Keep yourself and only current appointed handlers on this case.",
        );
    }
    const dueOn = input.dueOn
      ? caseSchema.shape.dueOn.parse(input.dueOn)
      : undefined;
    if (dueOn && dueOn < row.receivedOn.toISOString().slice(0, 10))
      throw new GovernanceError("Due date must be on or after receipt.");
    await tx.safeguardingCase.update({
      where: {
        workspaceId_id: { workspaceId: actor.workspace.id, id: row.id },
      },
      data: {
        status: input.status,
        closedAt: input.status === "CLOSED" ? new Date() : null,
        ...(dueOn ? { dueOn: new Date(dueOn) } : {}),
        ...(input.handlerIds
          ? { handlerIds: [...new Set(input.handlerIds)] }
          : {}),
      },
    });
    await audit(actor, tx, "updated", row.id);
  });
}
export async function completeCaseAction(
  actor: Actor,
  caseId: string,
  eventId: string,
) {
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const row = await caseAccess(actor, caseId, tx);
    if (row.closedAt)
      throw new GovernanceError("Closed case records are locked.");
    const changed = await tx.safeguardingEvent.updateMany({
      where: {
        workspaceId: actor.workspace.id,
        caseId,
        id: eventId,
        kind: "ACTION",
        completedAt: null,
      },
      data: { completedAt: new Date() },
    });
    if (!changed.count)
      throw new GovernanceError(
        "That action is unavailable. Refresh the case.",
      );
    await audit(actor, tx, "action_completed", caseId);
  });
}
export async function uploadCaseFile(actor: Actor, caseId: string, file: File) {
  let key: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await caseLock(actor, tx);
        const row = await caseAccess(actor, caseId, tx);
        if (row.closedAt)
          throw new GovernanceError("Closed case evidence is locked.");
        if (
          (await tx.safeguardingAttachment.count({
            where: { workspaceId: actor.workspace.id, caseId },
          })) >= 20
        )
          throw new GovernanceError("Use up to 20 evidence files per case.");
        const upload = await uploadWorkspaceFile({
          workspaceId: actor.workspace.id,
          uploadedById: actor.user.id,
          file,
          folder: "/safeguarding",
          allowedTypes: new Set([...RASTER_IMAGE_TYPES, "application/pdf"]),
          maxBytes: 10 * 1024 * 1024,
          client: tx,
        });
        if (!upload.ok) throw new GovernanceError(upload.error);
        key = upload.file.storageKey;
        await tx.safeguardingAttachment.create({
          data: {
            workspaceId: actor.workspace.id,
            caseId,
            fileId: upload.file.id,
          },
        });
        await audit(actor, tx, "file_added", caseId);
        return { id: upload.file.id };
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (key) await deleteObjects([key]).catch(() => undefined);
    throw e;
  }
}
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
