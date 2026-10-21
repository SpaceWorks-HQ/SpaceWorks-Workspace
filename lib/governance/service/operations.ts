import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { operationSchema, detailSchemas, AGM_ITEMS, nextDate } from "../schemas";
import { type Actor, lock, ensure } from "./access";
import { sync } from "./activity";

export async function operate(actor: Actor, raw: unknown) {
  const input = operationSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    if (input.op === "agm") {
      ensure(
        await tx.governanceRecord.findFirst({
          where: {
            id: input.parentId,
            workspaceId: actor.workspace.id,
            kind: "COMMITTEE",
            archivedAt: null,
          },
        }),
      );
      for (const [index, title] of AGM_ITEMS.entries()) {
        const key = `agm:${input.parentId}:${input.year}:${index}`;
        const row = await tx.governanceRecord.upsert({
          where: {
            workspaceId_kind_key: {
              workspaceId: actor.workspace.id,
              kind: "AGM_ITEM",
              key,
            },
          },
          create: {
            workspaceId: actor.workspace.id,
            kind: "AGM_ITEM",
            key,
            title,
            parentId: input.parentId,
            dueOn: new Date(input.dueOn),
            ownerId: actor.user.id,
            createdById: actor.user.id,
            details: { year: input.year },
          },
          update: {},
        });
        await sync(actor, tx, row, "checklist_added");
      }
      return { id: input.parentId };
    }
    const row = await tx.governanceRecord.findFirst({
      where: {
        id: input.id,
        workspaceId: actor.workspace.id,
        archivedAt: input.op === "restore" ? { not: null } : null,
      },
    });
    ensure(row);
    if (input.op === "restore") {
      if (row.parentId)
        ensure(
          await tx.governanceRecord.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              id: row.parentId,
              archivedAt: null,
            },
          }),
          "Restore this record's board or committee first.",
        );
      if (row.kind === "CONTRACT")
        ensure(
          await tx.governanceRecord.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              id: String((row.details as Prisma.JsonObject).vendorId),
              kind: "VENDOR",
              archivedAt: null,
            },
          }),
          "Restore this contract's vendor first.",
        );
      const restored = await tx.governanceRecord.update({
        where: {
          workspaceId_id: { workspaceId: actor.workspace.id, id: row.id },
        },
        data: { archivedAt: null },
      });
      await sync(actor, tx, restored, "restored");
      return { id: row.id };
    }
    if (input.op === "approve") {
      ensure(
        row.kind === "MINUTES" && row.status === "DRAFT" && !row.approvedAt,
        "Only draft minutes can be approved.",
      );
      ensure(
        row.meetingId &&
          (await tx.meeting.findFirst({
            where: {
              id: row.meetingId,
              workspaceId: actor.workspace.id,
              status: { not: "CANCELLED" },
            },
          })),
      );
      const updated = await tx.governanceRecord.update({
        where: {
          workspaceId_id: { workspaceId: actor.workspace.id, id: row.id },
        },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: actor.user.id,
        },
      });
      await sync(actor, tx, updated, "minutes_approved");
      return { id: row.id };
    }
    if (input.op === "next") {
      ensure(
        row.kind === "OBLIGATION" &&
          ["FILED", "DONE"].includes(row.status) &&
          row.dueOn,
        "Complete the obligation before adding its next occurrence.",
      );
      const detail = detailSchemas.OBLIGATION.parse(row.details);
      const due = nextDate(
        row.dueOn.toISOString().slice(0, 10),
        detail.recurrence,
      );
      ensure(due, "Choose a recurring obligation first.");
      const key = `next:${row.id}`;
      const next = await tx.governanceRecord.upsert({
        where: {
          workspaceId_kind_key: {
            workspaceId: actor.workspace.id,
            kind: "OBLIGATION",
            key,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          kind: "OBLIGATION",
          key,
          title: row.title,
          status: "TODO",
          dueOn: new Date(due),
          ownerId: row.ownerId,
          reminderDays: row.reminderDays,
          notes: row.notes,
          details: { ...detail, acknowledgement: "" },
          createdById: actor.user.id,
        },
        update: {},
      });
      await sync(actor, tx, next, "next_added");
      return { id: next.id };
    }
    ensure(
      !row.approvedAt,
      "Approved minutes stay in the record. Add a correction instead.",
    );
    ensure(
      !(await tx.governanceRecord.count({
        where: {
          workspaceId: actor.workspace.id,
          parentId: row.id,
          archivedAt: null,
        },
      })),
      "Archive this committee's records first.",
    );
    if (row.kind === "VENDOR")
      ensure(
        !(await tx.governanceRecord.count({
          where: {
            workspaceId: actor.workspace.id,
            kind: "CONTRACT",
            archivedAt: null,
            details: { path: ["vendorId"], equals: row.id },
          },
        })),
        "Archive the vendor's contracts first.",
      );
    const updated = await tx.governanceRecord.update({
      where: {
        workspaceId_id: { workspaceId: actor.workspace.id, id: row.id },
      },
      data: { archivedAt: new Date() },
    });
    await sync(actor, tx, updated, "archived");
    return { id: row.id };
  });
}

