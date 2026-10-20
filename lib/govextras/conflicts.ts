import "server-only";
import { prisma, type Tx } from "@/lib/db";
import {
  assertActor,
  GovernanceError,
  type Actor,
} from "@/lib/governance/service";
import { recordAuditEvent } from "@/lib/audit";
import { linkSchema, partyMatches } from "./rules";

export async function conflictTargets(actor: Actor, tx: Tx = prisma) {
  await assertActor(actor, tx);
  const workspaceId = actor.workspace.id;
  const [purchases, bills, contracts, decisions, resolutions, disbursements] =
    await Promise.all([
      tx.purchaseRequest.findMany({
        where: { workspaceId },
        select: {
          id: true,
          title: true,
          vendorOrgId: true,
          vendorOrg: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 1001,
      }),
      tx.financeBill.findMany({
        where: { workspaceId, privatePayroll:false },
        select: { id: true, vendor: true, number: true },
        orderBy: { createdAt: "desc" },
        take: 1001,
      }),
      tx.governanceRecord.findMany({
        where: { workspaceId, kind: "CONTRACT", archivedAt: null },
        select: { id: true, title: true, details: true },
        take: 1001,
      }),
      tx.decision.findMany({
        where: { workspaceId },
        select: { id: true, title: true },
        orderBy: { decidedAt: "desc" },
        take: 1001,
      }),
      tx.governanceRecord.findMany({
        where: { workspaceId, kind: "RESOLUTION", archivedAt: null },
        select: { id: true, title: true },
        take: 1001,
      }),
      tx.financeDisbursement.findMany({
        where: { workspaceId },
        select: { id: true, payee: true, purpose: true },
        orderBy: { createdAt: "desc" },
        take: 1001,
      }),
    ]);
  const vendors = await tx.governanceRecord.findMany({
    where: { workspaceId, kind: "VENDOR", archivedAt: null },
    select: { id: true, title: true, organisationId: true },
  });
  return [
    ...purchases.map((r) => ({
      id: r.id,
      type: "purchase" as const,
      label: r.title,
      party: r.vendorOrg?.name ?? "",
      organisationId: r.vendorOrgId,
    })),
    ...bills.map((r) => ({
      id: r.id,
      type: "bill" as const,
      label: `${r.number} · ${r.vendor}`,
      party: r.vendor,
      organisationId: null,
    })),
    ...contracts.map((r) => {
      const vendor = vendors.find(
        (v) => v.id === (r.details as Record<string, unknown>).vendorId,
      );
      return {
        id: r.id,
        type: "contract" as const,
        label: r.title,
        party: vendor?.title ?? "",
        organisationId: vendor?.organisationId ?? null,
      };
    }),
    ...decisions.map((r) => ({
      id: r.id,
      type: "decision" as const,
      label: r.title,
      party: "",
      organisationId: null,
    })),
    ...resolutions.map((r) => ({
      id: r.id,
      type: "resolution" as const,
      label: r.title,
      party: "",
      organisationId: null,
    })),
    ...disbursements.map((r) => ({
      id: r.id,
      type: "disbursement" as const,
      label: `${r.payee} · ${r.purpose}`,
      party: r.payee,
      organisationId: null,
    })),
  ];
}
export async function linkConflict(actor: Actor, raw: unknown) {
  const input = linkSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
    await assertActor(actor, tx);
    const row = await tx.governanceRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: input.declarationId,
        kind: "CONFLICT",
        archivedAt: null,
      },
    });
    if (!row)
      throw new GovernanceError(
        "Choose a current declaration in this workspace.",
      );
    // Resolve the target directly: list limits must never silently authorise a foreign id.
    const where = { workspaceId: actor.workspace.id, id: input.targetId };
    const target =
      input.targetType === "purchase"
        ? await tx.purchaseRequest.findFirst({ where })
        : input.targetType === "bill"
          ? await tx.financeBill.findFirst({ where:{...where,privatePayroll:false} })
          : input.targetType === "decision"
            ? await tx.decision.findFirst({ where })
            : input.targetType === "disbursement"
              ? await tx.financeDisbursement.findFirst({ where })
              : await tx.governanceRecord.findFirst({
                  where: {
                    ...where,
                    kind:
                      input.targetType === "contract"
                        ? "CONTRACT"
                        : "RESOLUTION",
                    archivedAt: null,
                  },
                });
    if (!target)
      throw new GovernanceError("Choose a related record in this workspace.");
    await tx.recordLink.upsert({
      where: {
        workspaceId_fromType_fromId_toType_toId: {
          workspaceId: actor.workspace.id,
          fromType: "governance_conflict",
          fromId: row.id,
          toType: input.targetType,
          toId: input.targetId,
        },
      },
      create: {
        workspaceId: actor.workspace.id,
        fromType: "governance_conflict",
        fromId: row.id,
        toType: input.targetType,
        toId: input.targetId,
        label: input.note,
        createdById: actor.user.id,
      },
      update: { label: input.note },
    });
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "governance.conflict_linked",
      targetType: "governance",
      targetId: row.id,
      client: tx,
    });
  });
}
export async function loadConflictLinks(actor: Actor, id?: string) {
  await assertActor(actor);
  if (!id) return { targets: [], links: [], warnings: [] };
  const declaration = await prisma.governanceRecord.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      id,
      kind: "CONFLICT",
      archivedAt: null,
    },
  });
  if (!declaration) return { targets: [], links: [], warnings: [] };
  const d = declaration.details as Record<string, unknown>;
  const [targets, links] = await Promise.all([
    conflictTargets(actor),
    prisma.recordLink.findMany({
      where: {
        workspaceId: actor.workspace.id,
        fromType: "governance_conflict",
        fromId: id,
      },
      select: { id: true, toType: true, toId: true, label: true },
    }),
  ]);
  const organisation = d.partyOrgId
    ? await prisma.organisation.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: String(d.partyOrgId),
          deletedAt: null,
        },
        select: { name: true },
      })
    : null;
  const warnings = targets.filter(
    (t) =>
      (d.partyOrgId && t.organisationId === d.partyOrgId) ||
      partyMatches(String(d.partyName || organisation?.name || ""), t.party),
  );
  return { targets, links, warnings };
}
export type ConflictData = Awaited<ReturnType<typeof loadConflictLinks>>;
