import "server-only";
import type { Prisma, MoneyControlRecord } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { required } from "./validation";

export async function cashFloat(
  tx: DbClient,
  row: { workspaceId: string; accountId: string | null },
) {
  const f = await tx.moneyControlRecord.findFirst({
    where: {
      workspaceId: row.workspaceId,
      kind: "FLOAT",
      accountId: row.accountId,
      status: "ACTIVE",
    },
  });
  required(f, "Set up this cash account's float and custodian first.");
  return f;
}
export async function update(
  tx: DbClient,
  row: MoneyControlRecord,
  data: Prisma.MoneyControlRecordUpdateManyMutationInput,
) {
  await tx.moneyControlRecord.updateMany({
    where: { workspaceId: row.workspaceId, id: row.id },
    data,
  });
}
