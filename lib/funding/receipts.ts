import "server-only";
import { prisma } from "@/lib/db";
import { lockFinance } from "@/lib/finance/tools/access";
import { DocumentsError } from "@/lib/documents/access";
import { deleteObjects } from "@/lib/storage";
import { enqueueEmail } from "@/lib/outbox";
import { renderNotificationEmail } from "@/lib/email/templates";
import { lock, ensure, audit, FundingError, type Actor } from "./service";
import { object } from "./analytics";
export async function receiptOperation(
  actor: Actor,
  recordId: string,
  operation: "receipt" | "email",
) {
  let storageKey: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockFinance(tx, actor.workspace.id);
        await lock(actor, tx);
        const workspaceId = actor.workspace.id;
        const gift = await tx.fundingRecord.findFirst({
          where: {
            workspaceId,
            id: recordId,
            kind: "DONATION",
            archivedAt: null,
            status: "RECEIVED",
          },
        });
        ensure(gift);
        const donor = await tx.contact.findFirst({
          where: { workspaceId, id: gift.contactId ?? "", deletedAt: null },
        });
        ensure(donor);
        if (operation === "email") {
          ensure(
            gift.receiptFileId && gift.receiptNumber,
            "Generate the receipt PDF before emailing it.",
          );
          ensure(
            donor.consentStatus === "GRANTED" &&
              !donor.doNotContact &&
              donor.preferredChannel === "EMAIL",
            "Confirm email consent and preferred contact on the CRM donor profile first.",
          );
          const emails = Array.isArray(donor.emails) ? donor.emails : [];
          const email = emails
            .map((e) => object(e))
            .find(
              (e) =>
                typeof e.value === "string" &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value),
            );
          ensure(
            email,
            "Add a valid email address to the donor's CRM profile.",
          );
          const controlled = await tx.documentFile.findFirst({
            where: { workspaceId, fileId: gift.receiptFileId, kind: "PDF" },
            include: {
              document: { select: { id: true, status: true } },
              file: { select: { checksum: true } },
            },
          });
          ensure(
            !controlled?.document || controlled.document.status === "ISSUED",
            "This receipt is cancelled. Open Documents to review the correction history.",
          );
          const rendered = renderNotificationEmail({
            title: `Donation receipt ${gift.receiptNumber}`,
            bodyHtml:
              "Thank you for supporting our work. Your donation receipt is attached.",
          });
          // Durable outbox reads only this generated file from private storage when delivering.
          const queued = await enqueueEmail(tx, {
            ...rendered,
            to: String(email.value),
            workspaceId,
            fundingReceipt: {
              recordId: gift.id,
              fileId: gift.receiptFileId,
              contactId: donor.id,
            },
          });
          if (controlled?.document && controlled.file.checksum)
            await tx.documentDelivery.create({
              data: {
                workspaceId,
                documentId: controlled.document.id,
                recipient: String(email.value),
                fileId: gift.receiptFileId,
                checksum: controlled.file.checksum,
                outboxId: queued.id,
                createdById: actor.user.id,
              },
            });
          await tx.fundingRecord.updateMany({
            where: { workspaceId, id: gift.id },
            data: { receiptEmailedAt: new Date() },
          });
          await audit(actor, tx, gift, "receipt_email_queued");
          return { id: gift.id };
        }
        if (gift.receiptFileId) {
          const { generateFundingReceipt } =
            await import("@/lib/documents/funding");
          await generateFundingReceipt(actor, gift, tx, (key) => {
            storageKey = key;
          });
          return { id: gift.id };
        }
        const { generateFundingReceipt } =
          await import("@/lib/documents/funding");
        await generateFundingReceipt(actor, gift, tx, (key) => {
          storageKey = key;
        });
        await audit(actor, tx, gift, "receipt_generated");
        return { id: gift.id };
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (storageKey) await deleteObjects([storageKey]).catch(() => undefined);
    if (e instanceof DocumentsError) throw new FundingError(e.message);
    throw e;
  }
}
