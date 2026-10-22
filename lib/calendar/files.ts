import "server-only";
import { prisma } from "@/lib/db";
import { type Actor, assertActor, ensure, serial } from "@/lib/meetings/core";
import {
  uploadWorkspaceFile,
  deleteObjects,
  RASTER_IMAGE_TYPES,
} from "@/lib/storage";
import { entryWhere } from "./access";
import { recordAuditEvent } from "@/lib/audit";
const TYPES = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export async function attachCalendarFile(actor: Actor, id: string, file: File) {
  await assertActor(actor, prisma, false);
  const row = await prisma.calendarEntry.findFirst({
    where: { AND: [await entryWhere(actor), { id, ownerId: actor.user.id }] },
  });
  ensure(
    row && row.fileIds.length < 20,
    "Choose a calendar record with fewer than 20 files.",
  );
  const uploaded = await uploadWorkspaceFile({
    workspaceId: actor.workspace.id,
    uploadedById: actor.user.id,
    file,
    folder: "/calendar",
    allowedTypes: TYPES,
  });
  ensure(uploaded.ok, uploaded.ok ? undefined : uploaded.error);
  try {
    await serial(async (tx) => {
      await assertActor(actor, tx, false);
      const current = await tx.calendarEntry.findFirst({
        where: { workspaceId: actor.workspace.id, id, ownerId: actor.user.id },
      });
      ensure(current && current.fileIds.length < 20);
      await tx.calendarEntry.update({
        where: { id, workspaceId: actor.workspace.id },
        data: { fileIds: { push: uploaded.file.id } },
      });
      await recordAuditEvent({
        client: tx,
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        action: "calendar.file_attached",
        targetType: "CalendarEntry",
        targetId: id,
      });
    });
  } catch (error) {
    await prisma.fileObject.deleteMany({
      where: { id: uploaded.file.id, workspaceId: actor.workspace.id },
    });
    await deleteObjects([uploaded.file.storageKey]);
    throw error;
  }
  return { id: uploaded.file.id };
}
