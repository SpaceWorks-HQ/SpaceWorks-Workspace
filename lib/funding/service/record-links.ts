import "server-only";
import { type Tx } from "@/lib/db";
import { type Kind } from "@/lib/funding/schema";

export async function linked(
  tx: Tx,
  workspaceId: string,
  id: string,
  kind: Kind | Kind[],
) {
  return tx.fundingRecord.findFirst({
    where: {
      workspaceId,
      id,
      archivedAt: null,
      kind: { in: Array.isArray(kind) ? kind : [kind] },
    },
  });
}
export const PARENTS: Partial<Record<Kind, Kind>> = {
  INSTALMENT: "GRANT",
  REPORT: "GRANT",
  DELIVERABLE: "GRANT",
  KPI: "PROGRAMME",
  IMPACT_ENTRY: "KPI",
  ACCESS_REVIEW: "TOOL_ACCOUNT",
};
