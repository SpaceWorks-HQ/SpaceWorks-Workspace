import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { visibleDocsWhere } from "@/lib/docs/service";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import {
  type Actor,
  assertActor,
  ensure,
  id,
  serial,
  admin,
} from "@/lib/meetings/core";

export const contentHash = (title: string, html: string) =>
  createHash("sha256").update(JSON.stringify({ title, html })).digest("hex");
export const ipHash = (workspaceId: string, ip: string) =>
  createHash("sha256").update(`${workspaceId}:${ip}`).digest("hex");
export const signatureCommand = z.discriminatedUnion("op", [
  z.object({ op: z.literal("request"), docId: id, signerUserId: id }),
  z.object({
    op: z.literal("sign"),
    requestId: id,
    typedName: z.string().trim().min(2, "Type your full name.").max(150),
    acknowledge: z.literal(true),
  }),
  z.object({ op: z.literal("decline"), requestId: id }),
  z.object({ op: z.literal("remind"), requestId: id }),
]);

export async function signatureView(actor: Actor, requestId: string) {
  const request = await prisma.signatureRequest.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      id: requestId,
      ...(admin(actor)
        ? {}
        : {
            OR: [
              { signerUserId: actor.user.id },
              { createdById: actor.user.id },
            ],
          }),
    },
    select: {
      id: true,
      docId: true,
      docRevisionId: true,
      contentHash: true,
      signerUserId: true,
      status: true,
      typedName: true,
      signedAt: true,
      createdAt: true,
      createdById: true,
    },
  });
  if (!request) return null;
  const doc = await prisma.doc.findFirst({
    where: {
      ...visibleDocsWhere(actor.workspace.id, actor.membership.role),
      id: request.docId,
      archivedAt: null,
    },
  });
  if (!doc) return null;
  const snapshot = await prisma.activityEvent.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      entityType: "signature_snapshot",
      entityId: request.id,
    },
  });
  const stored = snapshot?.data as { title?: string; html?: string } | null;
  return {
    ...request,
    title: stored?.title ?? doc.title,
    html: stored?.html ?? doc.contentHtml,
    currentMatches:
      contentHash(doc.title, doc.contentHtml) === request.contentHash,
  };
}

export async function mutateSignature(
  actor: Actor,
  input: unknown,
  clientIp = "unknown",
) {
  const data = signatureCommand.parse(input);
  const result = await serial(async (tx) => {
    await assertActor(actor, tx, data.op === "request");
    if (data.op === "request") {
      const doc = await tx.doc.findFirst({
        where: {
          ...visibleDocsWhere(actor.workspace.id, actor.membership.role),
          id: data.docId,
          archivedAt: null,
        },
      });
      ensure(
        doc && (admin(actor) || doc.createdById === actor.user.id),
        "Only the document creator or an admin can request acknowledgement.",
      );
      const signer = await tx.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: data.signerUserId,
          status: "ACTIVE",
          user: { disabledAt: null },
          ...(doc.visibility === "ADMINS"
            ? { role: { in: ["OWNER", "ADMIN"] } }
            : {}),
        },
      });
      ensure(signer, "Choose a member who can read this document.");
      const hash = contentHash(doc.title, doc.contentHtml);
      const existing = await tx.signatureRequest.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          docId: doc.id,
          signerUserId: data.signerUserId,
          contentHash: hash,
          status: { in: ["PENDING", "SIGNED"] },
        },
      });
      if (existing) return { id: existing.id, notification: null };
      const revision = await tx.docRevision.findFirst({
        where: {
          docId: doc.id,
          doc: { workspaceId: actor.workspace.id },
          title: doc.title,
          contentHtml: doc.contentHtml,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const request = await tx.signatureRequest.create({
        data: {
          workspaceId: actor.workspace.id,
          docId: doc.id,
          docRevisionId: revision?.id,
          contentHash: hash,
          signerUserId: data.signerUserId,
          createdById: actor.user.id,
        },
      });
      // Immutable request snapshot uses an area-owned activity record, scoped to the signer.
      await recordActivity(
        {
          workspaceId: actor.workspace.id,
          actorId: data.signerUserId,
          entityType: "signature_snapshot",
          entityId: request.id,
          verb: "requested",
          summary: "Document acknowledgement requested",
          visibility: "PRIVATE",
          data: { title: doc.title, html: doc.contentHtml },
        },
        tx,
      );
      await recordAuditEvent({
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        action: "signature.requested",
        targetType: "SignatureRequest",
        targetId: request.id,
        client: tx,
      });
      const notification = await dispatch(
        actor.workspace.id,
        {
          type: "signature.requested",
          title: "A document needs your acknowledgement",
          actorId: actor.user.id,
          recipients: [data.signerUserId],
          useWorkspaceRules: false,
          url: `/w/${actor.workspace.slug}/sign/${request.id}`,
          resource: { type: "doc", id: doc.id },
          data: { signatureRequestId: request.id, docId: doc.id },
        },
        { tx },
      );
      return { id: request.id, notification };
    }
    const request = await tx.signatureRequest.findFirst({
      where: { workspaceId: actor.workspace.id, id: data.requestId },
    });
    ensure(request);
    const doc = await tx.doc.findFirst({
      where: {
        ...visibleDocsWhere(actor.workspace.id, actor.membership.role),
        id: request.docId,
        archivedAt: null,
      },
    });
    ensure(doc);
    ensure(
      request.status === "PENDING",
      "This request has already been completed.",
    );
    if (data.op === "remind") {
      ensure(admin(actor) || request.createdById === actor.user.id);
      const signer = await tx.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: request.signerUserId ?? "",
          status: "ACTIVE",
          user: { disabledAt: null },
          ...(doc.visibility === "ADMINS"
            ? { role: { in: ["ADMIN", "OWNER"] } }
            : {}),
        },
      });
      ensure(signer);
      const notification = await dispatch(
        actor.workspace.id,
        {
          type: "signature.requested",
          title: "Reminder: please acknowledge a document",
          recipients: [signer.userId],
          actorId: actor.user.id,
          useWorkspaceRules: false,
          dedupeKey: `signature:${request.id}:${new Date().toISOString().slice(0, 10)}`,
          dedupeWindowSec: 86_400,
          resource: { type: "doc", id: doc.id },
          url: `/w/${actor.workspace.slug}/sign/${request.id}`,
          data: { signatureRequestId: request.id, docId: doc.id },
        },
        { tx },
      );
      await recordAuditEvent({
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        action: "signature.reminded",
        targetType: "SignatureRequest",
        targetId: request.id,
        client: tx,
      });
      return { id: request.id, notification };
    }
    ensure(request.signerUserId === actor.user.id);
    if (data.op === "sign")
      ensure(
        contentHash(doc.title, doc.contentHtml) === request.contentHash,
        "The document changed. Ask for a new acknowledgement request.",
      );
    await tx.signatureRequest.updateMany({
      where: {
        workspaceId: actor.workspace.id,
        id: request.id,
        status: "PENDING",
        signerUserId: actor.user.id,
      },
      data:
        data.op === "sign"
          ? {
              status: "SIGNED",
              typedName: data.typedName,
              signedAt: new Date(),
              ip: ipHash(actor.workspace.id, clientIp),
            }
          : { status: "DECLINED" },
    });
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: `signature.${data.op === "sign" ? "signed" : "declined"}`,
      targetType: "SignatureRequest",
      targetId: request.id,
      client: tx,
    });
    return { id: request.id, notification: null };
  });
  await result.notification?.afterCommit();
  return { id: result.id };
}
