import "server-only";
import {
  Prisma,
  type GovernanceRecord,
  type WorkspaceRole,
} from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { canManageGovernance } from "@/lib/roles";
import {
  recordSchema,
  detailSchemas,
  bankSchema,
  operationSchema,
  AGM_ITEMS,
  nextDate,
  sectionFor,
  sectionPath,
  dayInZone,
  type Section,
} from "./schemas";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import {
  indexSearchDocument,
  removeSearchDocument,
} from "@/lib/search/documents";
import { nextWorkspaceSequence } from "@/lib/counters";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  uploadWorkspaceFile,
  deleteObjects,
  RASTER_IMAGE_TYPES,
} from "@/lib/storage";

export type Actor = {
  user: { id: string };
  workspace: { id: string; slug: string; timezone: string };
  membership: { role: WorkspaceRole };
};
export class GovernanceError extends Error {}
const ensure: (condition: unknown, message?: string) => asserts condition = (
  condition,
  message = "That record is unavailable. Refresh and try again.",
) => {
  if (!condition) throw new GovernanceError(message);
};
/** Recheck current authority inside each transaction, including stale actors. */
export async function assertActor(actor: Actor, tx: Tx = prisma) {
  const m = await tx.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
    select: { role: true },
  });
  ensure(m && canManageGovernance(m), "You don't have access to do that.");
}
async function lock(actor: Actor, tx: Tx) {
  // One short workspace lock serialises record edits, approvals and recurrence/checklist retries.
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
  await assertActor(actor, tx);
}
async function audit(
  actor: Actor,
  tx: Tx,
  record: GovernanceRecord,
  verb: string,
) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `governance.${verb}`,
    targetType: record.kind,
    targetId: record.id,
    client: tx,
  });
}
async function sync(actor: Actor, tx: Tx, row: GovernanceRecord, verb: string) {
  await audit(actor, tx, row, verb);
  if (row.archivedAt) await removeSearchDocument("governance", row.id, tx);
  else
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "governance",
        entityId: row.id,
        title: row.title,
        url: `/w/${actor.workspace.slug}/governance${sectionPath(sectionFor(row.kind))}?edit=${row.id}`,
        visibility: "PRIVATE",
        ownerId: row.ownerId ?? actor.user.id,
      },
      tx,
    );
  await recordActivity(
    {
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      entityType: "governance",
      entityId: row.id,
      verb,
      summary: `Governance record ${verb}.`,
      visibility: "PRIVATE",
    },
    tx,
  );
}
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
      input.status !== "APPROVED",
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
      details,
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

export async function changeBank(actor: Actor, raw: unknown) {
  const input = bankSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    const vendor = await tx.governanceRecord.findFirst({
      where: {
        id: input.vendorId,
        workspaceId: actor.workspace.id,
        kind: "VENDOR",
        archivedAt: null,
      },
    });
    ensure(vendor);
    const { vendorId, reason, ...bank } = input;
    await tx.governanceBankChange.create({
      data: {
        workspaceId: actor.workspace.id,
        vendorId,
        actorId: actor.user.id,
        reason,
        bankEnc: encryptSecret("governance-vendor-bank", JSON.stringify(bank)),
      },
    });
    await audit(actor, tx, vendor, "bank_changed");
  });
}
export async function revealBank(actor: Actor, vendorId: string) {
  return prisma.$transaction(async (tx) => {
    await assertActor(actor, tx);
    const vendor = await tx.governanceRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: vendorId,
        kind: "VENDOR",
        archivedAt: null,
      },
    });
    ensure(vendor);
    const bank = await tx.governanceBankChange.findFirst({
      where: { workspaceId: actor.workspace.id, vendorId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    await audit(actor, tx, vendor, "bank_revealed");
    return bank
      ? (JSON.parse(decryptSecret("governance-vendor-bank", bank.bankEnc)) as {
          accountName: string;
          bankName: string;
          accountNumber: string;
          routingCode: string;
        })
      : null;
  });
}
const PROOF_TYPES = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export async function attachFile(actor: Actor, recordId: string, file: File) {
  let key: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lock(actor, tx);
        const record = await tx.governanceRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: recordId,
            archivedAt: null,
          },
        });
        ensure(record);
        ensure(
          !record.approvedAt,
          "Approved minutes and their attachments are locked.",
        );
        ensure(
          (await tx.governanceAttachment.count({
            where: {
              workspaceId: actor.workspace.id,
              recordId,
              file: { deletedAt: null },
            },
          })) < 20,
          "This record has 20 files. Remove an unused file first.",
        );
        const uploaded = await uploadWorkspaceFile({
          workspaceId: actor.workspace.id,
          uploadedById: actor.user.id,
          file,
          folder: "/governance",
          allowedTypes: PROOF_TYPES,
          maxBytes: 10 * 1024 * 1024,
          client: tx,
        });
        ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error);
        key = uploaded.file.storageKey;
        await tx.governanceAttachment.create({
          data: {
            workspaceId: actor.workspace.id,
            recordId,
            fileId: uploaded.file.id,
          },
        });
        await audit(actor, tx, record, "file_added");
        return { id: uploaded.file.id };
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (key) await deleteObjects([key]).catch(() => undefined);
    throw error;
  }
}
export async function detachFile(
  actor: Actor,
  recordId: string,
  fileId: string,
) {
  await prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    const record = await tx.governanceRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: recordId,
        archivedAt: null,
      },
    });
    ensure(
      record && !record.approvedAt,
      "Approved minutes and their attachments are locked.",
    );
    ensure(
      await tx.governanceAttachment.findFirst({
        where: { workspaceId: actor.workspace.id, recordId, fileId },
      }),
    );
    // Soft-delete for the existing storage retention writer, keeping the private attachment link.
    await tx.fileObject.updateMany({
      where: { workspaceId: actor.workspace.id, id: fileId },
      data: { deletedAt: new Date() },
    });
    await audit(actor, tx, record, "file_removed");
  });
}
export type Filters = {
  q?: string;
  status?: string;
  owner?: string;
  kind?: string;
  overdue?: string;
  page?: string;
  archived?: string;
};
export function recordsWhere(
  workspaceId: string,
  section: Section,
  timezone: string,
  filter: Filters,
): Prisma.GovernanceRecordWhereInput {
  const kinds =
    section === "compliance"
      ? (["LEGAL_ENTITY", "OBLIGATION"] as const)
      : section === "vendors"
        ? (["VENDOR", "CONTRACT"] as const)
        : ([
            "COMMITTEE",
            "TERM",
            "MINUTES",
            "RESOLUTION",
            "CONFLICT",
            "AGM_ITEM",
          ] as const);
  const kind = kinds.find((k) => k === filter.kind);
  return {
    workspaceId,
    archivedAt: filter.archived === "1" ? { not: null } : null,
    kind: kind ?? { in: [...kinds] },
    ...(filter.q
      ? { title: { contains: filter.q.slice(0, 200), mode: "insensitive" } }
      : {}),
    ...(filter.status ? { status: filter.status.slice(0, 30) } : {}),
    ...(filter.owner ? { ownerId: filter.owner.slice(0, 64) } : {}),
    ...(filter.overdue === "1"
      ? {
          kind: "OBLIGATION",
          status: "TODO",
          dueOn: { lt: new Date(dayInZone(new Date(), timezone)) },
        }
      : {}),
  };
}
export async function loadGovernance(
  actor: Actor,
  section: Section,
  filters: Filters,
  edit?: string,
) {
  await assertActor(actor);
  const where = recordsWhere(
    actor.workspace.id,
    section,
    actor.workspace.timezone,
    filters,
  );
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1),
  );
  const [
    records,
    total,
    selected,
    owners,
    committees,
    organisations,
    vendors,
    meetings,
    contacts,
  ] = await Promise.all([
    prisma.governanceRecord.findMany({
      where,
      orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 30,
      skip: (page - 1) * 30,
    }),
    prisma.governanceRecord.count({ where }),
    edit
      ? prisma.governanceRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: edit.slice(0, 64),
            archivedAt: filters.archived === "1" ? { not: null } : null,
          },
          include: {
            attachments: {
              where: { file: { deletedAt: null } },
              include: {
                file: {
                  select: {
                    id: true,
                    filename: true,
                    contentType: true,
                    size: true,
                  },
                },
              },
            },
            bankChanges: {
              select: {
                id: true,
                reason: true,
                actorId: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 50,
            },
          },
        })
      : null,
    prisma.membership.findMany({
      where: {
        workspaceId: actor.workspace.id,
        status: "ACTIVE",
        role: { in: ["ADMIN", "OWNER"] },
        user: { disabledAt: null },
      },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        kind: "COMMITTEE",
        archivedAt: null,
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.organisation.findMany({
      where: { workspaceId: actor.workspace.id, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        kind: "VENDOR",
        archivedAt: null,
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.meeting.findMany({
      where: { workspaceId: actor.workspace.id, status: { not: "CANCELLED" } },
      select: { id: true, title: true },
      orderBy: { startsAt: "desc" },
    }),
    prisma.contact.findMany({
      where: { workspaceId: actor.workspace.id, deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
  ]);
  return {
    records,
    total,
    page,
    selected:
      selected && sectionFor(selected.kind) === section ? selected : null,
    owners,
    committees,
    organisations,
    vendors,
    meetings,
    contacts,
  };
}
