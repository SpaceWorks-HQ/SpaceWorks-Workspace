import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateExtraReferences } from "@/lib/govextras/references";
import { nextWorkspaceSequence } from "@/lib/counters";
import { recordSchema, detailSchemas } from "../schemas";
import { type Actor, lock, ensure } from "./access";
import { sync } from "./activity";

export async function saveRecord(actor: Actor, raw: unknown) {
  const input = recordSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    const old = input.id
      ? await tx.governanceRecord.findFirst({
          where: {
            id: input.id,
            workspaceId: actor.workspace.id,
            archivedAt: null,
          },
        })
      : null;
    if (input.id) ensure(old);
    ensure(!old || old.kind === input.kind);
    ensure(
      !old?.approvedAt,
      "Approved minutes are locked. Add a new minutes record for a correction.",
    );
    ensure(
      input.status !== "APPROVED" && input.status !== "FROZEN",
      "Use Approve minutes after reviewing the saved draft.",
    );
    if (input.ownerId)
      ensure(
        await tx.membership.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            userId: input.ownerId,
            status: "ACTIVE",
            role: { in: ["ADMIN", "OWNER"] },
            user: { disabledAt: null },
          },
        }),
        "Choose an active workspace admin as owner.",
      );
    if (input.parentId)
      ensure(
        await tx.governanceRecord.findFirst({
          where: {
            id: input.parentId,
            workspaceId: actor.workspace.id,
            kind: "COMMITTEE",
            archivedAt: null,
          },
        }),
        "Choose a board or committee in this workspace.",
      );
    if (input.meetingId)
      ensure(
        await tx.meeting.findFirst({
          where: {
            id: input.meetingId,
            workspaceId: actor.workspace.id,
            status: { not: "CANCELLED" },
          },
        }),
        "Choose a meeting in this workspace.",
      );
    if (input.organisationId)
      ensure(
        await tx.organisation.findFirst({
          where: {
            id: input.organisationId,
            workspaceId: actor.workspace.id,
            deletedAt: null,
          },
        }),
        "Choose a CRM organisation in this workspace.",
      );
    const details = detailSchemas[input.kind].parse(
      input.details,
    ) as Prisma.InputJsonObject;
    await validateExtraReferences(tx, actor, input.kind, details);
    if (input.kind === "TERM" && details.contactId)
      ensure(
        await tx.contact.findFirst({
          where: {
            id: String(details.contactId),
            workspaceId: actor.workspace.id,
            deletedAt: null,
          },
        }),
        "Choose a contact in this workspace.",
      );
    if (input.kind === "CONTRACT")
      ensure(
        await tx.governanceRecord.findFirst({
          where: {
            id: String(details.vendorId),
            workspaceId: actor.workspace.id,
            kind: "VENDOR",
            archivedAt: null,
          },
        }),
        "Choose a vendor in this workspace.",
      );
    const data = {
      title: input.title,
      status: input.status,
      ownerId: input.ownerId || null,
      parentId: input.parentId || null,
      organisationId: input.organisationId || null,
      meetingId: input.meetingId || null,
      dueOn: input.dueOn ? new Date(input.dueOn) : null,
      startsOn: input.startsOn ? new Date(input.startsOn) : null,
      endsOn: input.endsOn ? new Date(input.endsOn) : null,
      notes: input.notes,
      details: input.kind === "LEGAL_ENTITY" && old && old.details && typeof old.details === "object" && !Array.isArray(old.details) && old.details.documents
        ? { ...details, documents: old.details.documents as Prisma.InputJsonValue }
        : details,
      reminderDays: input.reminderDays,
    };
    const row = old
      ? await tx.governanceRecord.update({
          where: {
            workspaceId_id: { workspaceId: actor.workspace.id, id: old.id },
          },
          data,
        })
      : await tx.governanceRecord.create({
          data: {
            ...data,
            workspaceId: actor.workspace.id,
            kind: input.kind,
            key: input.kind === "LEGAL_ENTITY" ? "entity" : null,
            createdById: actor.user.id,
            number:
              input.kind === "RESOLUTION"
                ? await nextWorkspaceSequence(
                    tx,
                    actor.workspace.id,
                    "governance_resolution",
                  )
                : null,
          },
        });
    await sync(actor, tx, row, old ? "updated" : "created");
    return { id: row.id };
  });
}
