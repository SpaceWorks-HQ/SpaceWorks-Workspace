import "server-only";
import { Prisma, type MoneyControlRecord } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { assertOpen, validateMember, validateTags } from "@/lib/finance/tools/access";
import { financeNote } from "@/lib/finance/tools/service";
import { accountBalance } from "@/lib/finance/tools/close";
import type { ControlsActor, details } from "../access";
import { countDenominations, type transitionSchema } from "../rules";
import { required, proof } from "./validation";
import { cashFloat, update } from "./records";
import { movement } from "./movements";

export async function postControl(
  tx: DbClient,
  actor: ControlsActor,
  row: MoneyControlRecord,
  v: ReturnType<typeof transitionSchema.parse>,
  d: ReturnType<typeof details>,
) {
  required(v.operation === "POST", "Choose an available action.");
  await validateMember(tx, row.workspaceId, row.ownerId);
  await validateTags(
    tx,
    row.workspaceId,
    {
      accountId: row.accountId,
      categoryId: row.categoryId,
      fundId: row.fundId,
    },
    row.currency,
    row.kind === "VOUCHER" ? "EXPENSE" : undefined,
  );
  if (row.kind === "REPLENISHMENT") {
    required(
      row.status === "PENDING" && d.approvalId,
      "Request approval before recording replenishment.",
    );
    required(
      await tx.approvalRequest.findFirst({
        where: {
          workspaceId: row.workspaceId,
          id: String(d.approvalId),
          subjectType: "CUSTOM",
          subjectId: row.id,
          status: "APPROVED",
        },
      }),
      "Approve this replenishment in Requests first.",
    );
  } else
    required(row.status === "DRAFT", "This record is already confirmed.");
  if (
    [
      "VOUCHER",
      "DEPOSIT",
      "TRANSFER",
      "REPLENISHMENT",
      "SCHEDULE",
      "DISPOSAL",
      "VERIFICATION",
    ].includes(row.kind)
  )
    await proof(tx, row);
  if (row.kind === "CERTIFICATE") await proof(tx, row, true);
  if (
    [
      "VOUCHER",
      "DEPOSIT",
      "TRANSFER",
      "REPLENISHMENT",
      "DISPOSAL",
    ].includes(row.kind)
  )
    required(v.reference, "Enter the payment or voucher reference.");
  if (["VOUCHER", "COUNT", "REPLENISHMENT"].includes(row.kind))
    await cashFloat(tx, row);
  if (row.kind === "VOUCHER") {
    await assertOpen(tx, row.workspaceId, row.occurredOn, row.accountId);
    const balance = await accountBalance(
      tx,
      row.workspaceId,
      row.accountId!,
      row.occurredOn,
    );
    required(
      balance.balanceMinor >= row.amountMinor,
      "This voucher exceeds the cash account balance. Record replenishment first.",
    );
    const ledger = await tx.ledgerEntry.create({
      data: {
        workspaceId: row.workspaceId,
        kind: "EXPENSE",
        amountMinor: row.amountMinor,
        currency: row.currency,
        categoryId: row.categoryId,
        fundId: row.fundId,
        accountId: row.accountId,
        description: `Cash voucher CV-${String(row.number).padStart(5, "0")}: ${row.title}`,
        counterparty: String(d.payee ?? ""),
        occurredOn: row.occurredOn,
        sourceType: "cash_voucher",
        sourceId: row.id,
        createdById: actor.user.id,
      },
    });
    await financeNote(tx, actor, "entry", ledger.id, "created");
    await update(tx, row, {
      details: { ...d, ledgerEntryId: ledger.id } as Prisma.InputJsonValue,
    });
  } else if (["TRANSFER", "REPLENISHMENT"].includes(row.kind)) {
    const from =
        row.kind === "TRANSFER" ? row.accountId! : row.otherAccountId!,
      to = row.kind === "TRANSFER" ? row.otherAccountId! : row.accountId!;
    await movement(
      tx,
      row,
      from,
      -row.amountMinor,
      row.occurredOn,
      v.reference,
      v.operationKey,
    );
    await movement(
      tx,
      row,
      to,
      row.amountMinor,
      row.occurredOn,
      v.reference,
      v.operationKey,
    );
  } else if (row.kind === "DEPOSIT")
    await movement(
      tx,
      row,
      row.accountId!,
      d.direction === "GIVEN" ? -row.amountMinor : row.amountMinor,
      row.occurredOn,
      v.reference,
      v.operationKey,
    );
  else if (row.kind === "COUNT") {
    const counted = countDenominations(
        String(d.denominations),
        row.currency,
      ),
      balance = await accountBalance(
        tx,
        row.workspaceId,
        row.accountId!,
        row.occurredOn,
      ),
      difference = counted - balance.balanceMinor;
    required(
      !difference || row.notes.trim(),
      "Explain the cash-count difference before confirming.",
    );
    await update(tx, row, {
      amountMinor: counted,
      details: {
        ...d,
        expectedMinor: balance.balanceMinor,
        differenceMinor: difference,
        countedById: actor.user.id,
      } as Prisma.InputJsonValue,
    });
  } else if (row.kind === "SCHEDULE") {
    await tx.asset.updateMany({
      where: { workspaceId: row.workspaceId, id: row.assetId! },
      data: {
        purchaseDate: row.occurredOn,
        purchasePriceMinor: row.amountMinor,
        currency: row.currency,
      },
    });
  } else if (row.kind === "VERIFICATION") {
    await tx.asset.updateMany({
      where: { workspaceId: row.workspaceId, id: row.assetId! },
      data: { condition: String(d.condition), updatedAt: new Date() },
    });
    await update(tx, row, {
      details: {
        ...d,
        verifiedById: actor.user.id,
      } as Prisma.InputJsonValue,
    });
  } else if (row.kind === "DISPOSAL") {
    const asset = await tx.asset.findFirst({
      where: { workspaceId: row.workspaceId, id: row.assetId! },
    });
    required(
      asset && asset.status !== "RETIRED" && !asset.ownerUserId,
      "Return assigned equipment before disposal.",
    );
    const schedule = await tx.moneyControlRecord.findFirst({
      where: {
        workspaceId: row.workspaceId,
        kind: "SCHEDULE",
        assetId: row.assetId,
      },
    });
    required(
      !schedule || row.occurredOn >= schedule.occurredOn,
      "Disposal cannot predate purchase.",
    );
    required(
      !(await tx.moneyControlRecord.findFirst({
        where: {
          workspaceId: row.workspaceId,
          kind: "VERIFICATION",
          assetId: row.assetId,
          occurredOn: { gt: row.occurredOn },
          status: "RECORDED",
        },
      })),
      "Use a disposal date after the last verification.",
    );
    if (row.amountMinor) {
      required(
        d.method === "SALE" && row.accountId,
        "Sale proceeds need an account. Use zero proceeds for scrap or donation.",
      );
      await assertOpen(tx, row.workspaceId, row.occurredOn, row.accountId);
      await tx.ledgerEntry.create({
        data: {
          workspaceId: row.workspaceId,
          kind: "INCOME",
          amountMinor: row.amountMinor,
          currency: row.currency,
          description: `Asset disposal: ${row.title}`,
          occurredOn: row.occurredOn,
          accountId: row.accountId,
          sourceType: "asset_disposal",
          sourceId: row.id,
          createdById: actor.user.id,
        },
      });
    }
    await tx.asset.updateMany({
      where: { workspaceId: row.workspaceId, id: row.assetId! },
      data: { status: "RETIRED" },
    });
  } else if (row.kind === "ASSIGNMENT") {
    required(
      !(await tx.moneyControlRecord.findFirst({
        where: {
          workspaceId: row.workspaceId,
          assetId: row.assetId,
          kind: "ASSIGNMENT",
          status: "ASSIGNED",
        },
      })),
      "Return the current assignment before issuing this asset again.",
    );
    const asset = await tx.asset.findFirst({
      where: { workspaceId: row.workspaceId, id: row.assetId! },
    });
    required(
      asset &&
        asset.status === "AVAILABLE" &&
        (!asset.ownerUserId || asset.ownerUserId === row.ownerId),
      "Choose available equipment. Return its current assignment before changing the person.",
    );
    await validateMember(tx, row.workspaceId, row.ownerId);
    await tx.asset.updateMany({
      where: { workspaceId: row.workspaceId, id: row.assetId! },
      data: { ownerUserId: row.ownerId },
    });
  }
  const status =
    row.kind === "ASSIGNMENT"
      ? "ASSIGNED"
      : row.kind === "FILING"
        ? "PREPARED"
        : row.kind === "SCHEDULE"
          ? "ACTIVE"
          : ["COUNT"].includes(row.kind)
            ? "CONFIRMED"
            : ["TDS_DEDUCTION", "CERTIFICATE", "VERIFICATION"].includes(
                  row.kind,
                )
              ? "RECORDED"
              : "POSTED";
  required(
    !["FLOAT", "ASSET_CATEGORY", "FUND_RULE", "HANDOVER"].includes(
      row.kind,
    ),
    "Use the record's available action.",
  );
  await update(tx, row, { status });
}
