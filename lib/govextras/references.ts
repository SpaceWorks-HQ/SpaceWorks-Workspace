import "server-only";
import type { Tx } from "@/lib/db";
import type { Kind } from "@/lib/governance/schemas";
import { GovernanceError, type Actor } from "@/lib/governance/service";

export async function validateExtraReferences(
  tx: Tx,
  actor: Actor,
  kind: Kind,
  d: Record<string, unknown>,
) {
  const workspaceId = actor.workspace.id;
  const check = (value: unknown) => {
    if (!value)
      throw new GovernanceError("Choose a linked record in this workspace.");
  };
  if (d.partyOrgId)
    check(
      await tx.organisation.findFirst({
        where: { workspaceId, id: String(d.partyOrgId), deletedAt: null },
      }),
    );
  for (const [key, expected] of [
    ["obligationId", "OBLIGATION"],
    ["entityId", "LEGAL_ENTITY"],
    ["planId", "EMERGENCY_PLAN"],
  ] as const) {
    if (d[key])
      check(
        await tx.governanceRecord.findFirst({
          where: {
            workspaceId,
            id: String(d[key]),
            kind: expected,
            archivedAt: null,
          },
        }),
      );
  }
  if (d.docId)
    check(
      await tx.doc.findFirst({
        where: { workspaceId, id: String(d.docId), archivedAt: null },
      }),
    );
  if (kind === "BOARD_PACK") {
    for (const id of d.docIds as string[])
      check(
        await tx.doc.findFirst({
          where: { workspaceId, id, archivedAt: null },
        }),
      );
    for (const id of d.decisionIds as string[])
      check(await tx.decision.findFirst({ where: { workspaceId, id } }));
    for (const id of d.recordIds as string[])
      check(
        await tx.governanceRecord.findFirst({
          where: {
            workspaceId,
            id,
            archivedAt: null,
            kind: { not: "BOARD_PACK" },
          },
        }),
      );
  }
}
