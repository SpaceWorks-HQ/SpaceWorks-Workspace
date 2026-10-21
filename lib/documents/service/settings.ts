import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import {
  documentsAccess,
  DocumentsError,
  lockDocuments,
  type DocumentsActor,
} from "../access";
import {
  itemSchema,
  profileSchema,
  registrationSchema,
  signatorySchema,
  templateSchema,
} from "../rules";
import { audit, json, object } from "./shared";

export async function getSettings(
  actor: DocumentsActor,
  tx: DbClient = prisma,
) {
  await documentsAccess(actor, undefined, tx);
  const entity = await tx.governanceRecord.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      kind: "LEGAL_ENTITY",
      archivedAt: null,
    },
  });
  const details = object(entity?.details);
  const profile = profileSchema.parse({
    country: "IN",
    fiscalStartMonth: 4,
    ...object(details.documents),
  });
  const references = await tx.documentReference.findMany({
    where: {
      workspaceId: actor.workspace.id,
      archivedAt: null,
      kind: { in: ["REGISTRATION", "SIGNATORY", "ITEM", "TEMPLATE"] },
    },
    orderBy: { name: "asc" },
  });
  return { entity, details, profile, references };
}
export async function saveSettings(actor: DocumentsActor, raw: unknown) {
  await documentsAccess(actor);
  const profile = profileSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
    await documentsAccess(actor, undefined, tx);
    const { entity, details } = await getSettings(actor, tx);
    if (!entity)
      throw new DocumentsError("Add your legal entity in Governance first.");
    for (const fileId of [profile.logoFileId])
      if (
        fileId &&
        !(await tx.documentFile.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            fileId,
            kind: "PROFILE",
            documentId: null,
          },
        }))
      )
        throw new DocumentsError(
          "Upload the logo in Documents settings first.",
        );
    await tx.governanceRecord.update({
      where: { id: entity.id, workspaceId: actor.workspace.id },
      data: { details: json({ ...details, documents: profile }) },
    });
    await audit(actor, "settings_saved", entity.id, tx);
    return entity.id;
  });
}
export async function saveReference(
  actor: DocumentsActor,
  kind: string,
  name: string,
  raw: unknown,
  id?: string,
) {
  await documentsAccess(actor);
  const schemas = {
    REGISTRATION: registrationSchema,
    SIGNATORY: signatorySchema,
    ITEM: itemSchema,
    TEMPLATE: templateSchema,
  };
  if (!Object.hasOwn(schemas, kind))
    throw new DocumentsError("Choose a reference type.");
  const data = schemas[kind as keyof typeof schemas].parse(raw);
  if (!name.trim() || name.length > 200)
    throw new DocumentsError("Enter a reference name.");
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    await documentsAccess(actor, undefined, tx);
    if (kind === "SIGNATORY") {
      const fid = object(data).signatureFileId;
      if (
        typeof fid === "string" &&
        fid &&
        !(await tx.documentFile.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            fileId: fid,
            kind: "PROFILE",
            documentId: null,
          },
        }))
      )
        throw new DocumentsError(
          "Upload the signature in Documents settings first.",
        );
    }
    const row = id
      ? await tx.documentReference.findFirst({
          where: { workspaceId: actor.workspace.id, id, kind },
        })
      : null;
    if (id && !row) throw new DocumentsError("That reference is unavailable.");
    const saved = await tx.documentReference.upsert({
      where: { id: row?.id ?? "__new__" },
      create: {
        workspaceId: actor.workspace.id,
        kind,
        name: name.trim(),
        data: json(data),
        createdById: actor.user.id,
      },
      update: { name: name.trim(), data: json(data) },
    });
    await audit(actor, "reference_saved", saved.id, tx);
    return saved.id;
  });
}
