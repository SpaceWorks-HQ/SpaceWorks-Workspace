import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requestApproval } from "@/lib/approvals/engine";
import { FinanceError, lockFinance } from "@/lib/finance/tools/access";
import { accountBalance } from "@/lib/finance/tools/close";
import { lockAsset } from "@/lib/approvals/ops";
import { formatDate } from "@/lib/format/datetime";
import { controlsAccess, controlRecord, details, type ControlsActor } from "../access";
import { transitionSchema } from "../rules";
import { note } from "./events";
import { required, proof } from "./validation";
import { cashFloat, update } from "./records";
import { movement } from "./movements";
import { postControl } from "./post";

export async function transitionControl(actor: ControlsActor, input: unknown) {
  const v = transitionSchema.parse(input);
  const result = await prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const a = await controlsAccess(actor, tx),
      row = await controlRecord(actor, v.id, false, tx),
      d = details(row),
      date = new Date(v.occurredOn);
    if (/^(staff-advance:|emi:)/.test(row.recordKey??"")) throw new FinanceError("Manage this movement from Staff advances or Upcoming dues.");
    if (row.payroll)
      required(
        a.payrollManage,
        "Payroll records need an explicit Manage payroll grant.",
      );
    const personal = ["SIGN_IN", "SIGN_OUT", "ACKNOWLEDGE"].includes(
      v.operation,
    );
    if (!personal) required(a.manage, "You don't have access to do that.");
    if (row.assetId) await lockAsset(tx, row.workspaceId, row.assetId);
    // Retrying a financial operation must never post twice or change its saved facts.
    const previous = await tx.moneyControlEvent.findFirst({
      where: {
        workspaceId: row.workspaceId,
        recordId: row.id,
        reference: `key:${v.operationKey}`,
      },
    });
    if (previous) {
      required(
        previous.notes === JSON.stringify(v),
        "That operation reference was used with different details. Refresh and try again.",
      );
      return { id: row.id };
    }
    if (v.operation === "CANCEL") {
      required(
        ["DRAFT", "PENDING"].includes(row.status),
        "Only an unconfirmed record can be cancelled.",
      );
      const approvalId = d.approvalId;
      if (approvalId) {
        await tx.approvalRequest.updateMany({
          where: {
            workspaceId: row.workspaceId,
            id: String(approvalId),
            status: { in: ["PENDING", "CHANGES_REQUESTED"] },
          },
          data: { status: "CANCELLED", decidedAt: new Date() },
        });
      }
      await update(tx, row, { status: "CANCELLED" });
    } else if (v.operation === "REQUEST") {
      required(
        row.kind === "REPLENISHMENT" &&
          ["DRAFT", "PENDING"].includes(row.status),
        "Choose an unpaid replenishment request.",
      );
      const approval = await requestApproval(tx, {
        workspace: actor.workspace,
        subjectType: "CUSTOM",
        subjectId: row.id,
        title: `Replenish cash voucher account`,
        requesterId: actor.user.id,
        requesterName: actor.user.name,
        amountMinor: row.amountMinor,
        currency: row.currency,
      });
      await update(tx, row, {
        status: "PENDING",
        details: {
          ...d,
          approvalId: approval.requestId,
        } as Prisma.InputJsonValue,
      });
      await note(tx, actor, row, "REQUESTED");
      return { id: row.id, after: approval.afterCommit };
    } else if (v.operation === "SIGN_OUT" || v.operation === "SIGN_IN") {
      required(
        row.kind === "HANDOVER" && ["DRAFT", "PENDING"].includes(row.status),
        "Choose an unsigned custodian handover.",
      );
      const f = await cashFloat(tx, row);
      required(
        f.ownerId === d.outgoingId,
        "The custodian changed. Create a new handover.",
      );
      if (v.operation === "SIGN_OUT") {
        required(
          d.outgoingId === actor.user.id && !d.signedOutAt,
          "Only the outgoing custodian can sign this handover.",
        );
        const balance = await accountBalance(
          tx,
          row.workspaceId,
          row.accountId!,
          date,
        );
        required(
          balance.balanceMinor === row.amountMinor || v.notes.trim(),
          "Explain the difference between the handed-over cash and account balance.",
        );
        await update(tx, row, {
          status: "PENDING",
          details: {
            ...d,
            signedOutAt: new Date().toISOString(),
            signedOutOn: v.occurredOn,
            expectedMinor: balance.balanceMinor,
            differenceMinor: row.amountMinor - balance.balanceMinor,
            handoverNotes: v.notes,
          } as Prisma.InputJsonValue,
        });
      } else {
        required(
          row.ownerId === actor.user.id && d.signedOutAt,
          "The incoming custodian signs after the outgoing custodian.",
        );
        required(
          v.occurredOn >= String(d.signedOutOn),
          "The incoming signature cannot predate the outgoing signature.",
        );
        const balance = await accountBalance(
          tx,
          row.workspaceId,
          row.accountId!,
          date,
        );
        required(
          balance.balanceMinor === d.expectedMinor,
          "The account changed after sign-out. Cancel this handover and record a fresh count.",
        );
        await update(tx, row, {
          status: "CONFIRMED",
          details: {
            ...d,
            signedInAt: new Date().toISOString(),
            signedInOn: v.occurredOn,
          } as Prisma.InputJsonValue,
        });
        await update(tx, f, { ownerId: row.ownerId });
      }
    } else if (v.operation === "ACKNOWLEDGE") {
      required(
        row.kind === "ASSIGNMENT" &&
          row.status === "ASSIGNED" &&
          row.ownerId === actor.user.id &&
          !d.acknowledgedAt,
        "Only the assigned person can acknowledge this equipment.",
      );
      await update(tx, row, {
        details: {
          ...d,
          acknowledgedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      });
    } else if (v.operation === "RETURN") {
      required(
        v.reference &&
          v.occurredOn >= row.occurredOn.toISOString().slice(0, 10),
        "Enter a return date and reference after the original record date.",
      );
      if (row.kind === "ASSIGNMENT") {
        required(
          row.status === "ASSIGNED" && v.notes,
          "Choose an assigned asset and describe its return condition.",
        );
        await tx.asset.updateMany({
          where: {
            workspaceId: row.workspaceId,
            id: row.assetId!,
            ownerUserId: row.ownerId,
          },
          data: { ownerUserId: null, condition: v.notes.slice(0, 200) },
        });
        await update(tx, row, {
          status: "RETURNED",
          details: {
            ...d,
            returnedOn: v.occurredOn,
            returnedById: actor.user.id,
            returnCondition: v.notes,
          } as Prisma.InputJsonValue,
        });
      } else {
        required(
          row.kind === "DEPOSIT" &&
            ["POSTED", "PARTLY_RETURNED"].includes(row.status) &&
            v.amountMinor > 0 &&
            row.settledMinor + v.amountMinor <= row.amountMinor,
          "Enter a return up to the deposit's outstanding amount.",
        );
        await proof(tx, row);
        await movement(
          tx,
          row,
          row.accountId!,
          d.direction === "GIVEN" ? v.amountMinor : -v.amountMinor,
          date,
          v.reference,
          v.operationKey,
        );
        await update(tx, row, {
          settledMinor: row.settledMinor + v.amountMinor,
          status:
            row.settledMinor + v.amountMinor === row.amountMinor
              ? "RETURNED"
              : "PARTLY_RETURNED",
        });
      }
    } else if (["SUBMITTED", "ACCEPTED", "PAID"].includes(v.operation)) {
      const order = ["PREPARED", "SUBMITTED", "ACCEPTED", "PAID"];
      required(
        row.kind === "FILING" &&
          order.indexOf(v.operation) === order.indexOf(row.status) + 1,
        "Record prepared, submitted, accepted and paid in order.",
      );
      required(v.reference, "Enter the acknowledgement or payment reference.");
      await proof(tx, row);
      await update(tx, row, { status: v.operation });
    } else {
      await postControl(tx, actor, row, v, d);
    }
    await note(
      tx,
      actor,
      row,
      v.operation,
      v.reference,
      `${formatDate(v.occurredOn, "UTC")}${v.notes ? ": " + v.notes : ""}`,
    );
    await tx.moneyControlEvent.create({
      data: {
        workspaceId: row.workspaceId,
        recordId: row.id,
        actorId: actor.user.id,
        action: "OPERATION",
        reference: `key:${v.operationKey}`,
        notes: JSON.stringify(v),
      },
    });
    return { id: row.id };
  });
  await result.after?.();
  return result.id;
}
