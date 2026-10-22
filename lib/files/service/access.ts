import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { canEditDoc } from "@/lib/docs/rules";
import { CHAT_FOLDER } from "@/lib/files/versions";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { Prisma } from "@prisma/client";

import { type FilesActor } from "./types";

export const OTHER_AREA_RELATIONS: Prisma.FileObjectWhereInput = {
  documentFiles: { none: {} },
  marketingItAttachments: { none: { fromLibrary: false } },
  productAttachments: { none: {} },
  fundingAttachments: { none: {} },
  governanceAttachments: { none: {} },
  safeguardingAttachments: { none: {} },
  orgPeopleAttachments: { none: {} },
  messageAttachments: { none: {} },
  ledgerReceipts: { none: {} },
  financeAttachments: { none: {} },
  moneyControlAttachments: { none: {} },
  subscriptionContracts: { none: {} },
  certificationEvidence: { none: {} },
  statusPageLogos: { none: {} },
  signedPdfs: { none: {} },
  opsAttachments: { none: {} },
};

/** Chat uploads (message attachments, the /chat folder) belong to chat, not the library. */
export const NOT_CHAT: Prisma.FileObjectWhereInput = {
  messageAttachments: { none: {} },
  NOT: { OR: [{ folder: { startsWith: "/analytics" } }, { folder: { startsWith: "/documents" } }, { folder: "/safeguarding" }, { folder: { startsWith: "/safeguarding/" } }, { folder: { startsWith: "/money-controls" } }, { folder: "/funding" }, { folder: { startsWith: "/funding/" } }, { folder: "/people-service" }, { folder: { startsWith: "/people-service/" } }, { folder: CHAT_FOLDER }, { folder: { startsWith: `${CHAT_FOLDER}/` } }, { folder: "/governance" }, { folder: { startsWith: "/governance/" } }, { folder: "/calendar" }, { folder: { startsWith: "/calendar/" } }, { folder: { startsWith: "/finance-tools" } }, { folder: { startsWith: "/org-people" } }, { folder: { startsWith: "/marketing-it" } }, { folder: { startsWith: "/marketing-assets" } }, { folder: "/product-ops" }, { folder: { startsWith: "/product-ops/" } }] },
};

export const RESERVED_FOLDER = "That folder is managed by its tool. Choose another folder.";

/** Array references have no Prisma relation; keep these files with their owning area. */
export async function areaOwnedFileIds(workspaceId: string, client: DbClient = prisma): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT unnest("fileIds") AS id FROM "PurchaseRequest" WHERE "workspaceId"=${workspaceId}
    UNION SELECT unnest("fileIds") AS id FROM "CalendarEntry" WHERE "workspaceId"=${workspaceId}
    UNION SELECT unnest("receiptFileIds") AS id FROM "Reimbursement" WHERE "workspaceId"=${workspaceId}
    UNION SELECT unnest("photoFileIds") AS id FROM "Asset" WHERE "workspaceId"=${workspaceId}`;
  return rows.map((row) => row.id);
}

/** Prisma filter for library files this member may see (`deleted` for the trash view). */
export async function libraryWhere(actor: FilesActor, options: { deleted?: boolean } = {}): Promise<Prisma.FileObjectWhereInput> {
  const admin = hasRoleAtLeast(actor.membership.role, "ADMIN");
  const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
  return {
    workspaceId: actor.workspace.id,
    deletedAt: options.deleted ? { not: null } : null,
    ...OTHER_AREA_RELATIONS,
    ...NOT_CHAT,
    AND: [
      { id: { notIn: await areaOwnedFileIds(actor.workspace.id) } },
      admin ? {} : { OR: [{ docId: null }, { doc: { visibility: "WORKSPACE" } }] },
      hidden.length === 0 ? {} : { OR: [{ taskId: null }, { task: { projectId: null } }, { task: { project: teamScopeFilter(hidden) } }] },
    ],
  };
}

export async function findLibraryFile(actor: FilesActor, fileId: string, options: { deleted?: boolean } = {}) {
  return prisma.fileObject.findFirst({ where: { id: fileId, ...(await libraryWhere(actor, options)) } });
}

export async function checkDocLink(actor: FilesActor, docId: string) {
  const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true, visibility: true } });
  return Boolean(doc && canEditDoc(actor.membership, doc));
}

export async function checkTaskLink(actor: FilesActor, taskId: string) {
  const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: actor.workspace.id, ...(hidden.length ? { OR: [{ projectId: null }, { project: teamScopeFilter(hidden) }] } : {}) },
    select: { id: true },
  });
  return Boolean(task);
}
