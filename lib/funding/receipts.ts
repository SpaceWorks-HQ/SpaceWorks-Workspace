import "server-only";
import { prisma } from "@/lib/db";
import { nextWorkspaceSequence } from "@/lib/counters";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { enqueueEmail } from "@/lib/outbox";
import { renderNotificationEmail } from "@/lib/email/templates";
import { formatDate } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
import { lock, ensure, audit, type Actor } from "./service";
import { object, rupeesInWords } from "./analytics";
import { detailSchemas } from "./schema";
import { createFundingPdf } from "./pdf";
export async function receiptOperation(actor: Actor, recordId: string, operation: "receipt" | "email") {
  let storageKey: string | undefined;
  try {
    return await prisma.$transaction(async tx => {
      await lock(actor, tx); const workspaceId = actor.workspace.id;
      const gift = await tx.fundingRecord.findFirst({ where: { workspaceId, id: recordId, kind: "DONATION", archivedAt: null, status: "RECEIVED" } }); ensure(gift);
      const donor = await tx.contact.findFirst({ where: { workspaceId, id: gift.contactId ?? "", deletedAt: null } }); ensure(donor);
      if (operation === "email") {
        ensure(gift.receiptFileId && gift.receiptNumber, "Generate the receipt PDF before emailing it.");
        ensure(donor.consentStatus === "GRANTED" && !donor.doNotContact && donor.preferredChannel === "EMAIL", "Confirm email consent and preferred contact on the CRM donor profile first.");
        const emails = Array.isArray(donor.emails) ? donor.emails : [];
        const email = emails.map(e => object(e)).find(e => typeof e.value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.value)); ensure(email, "Add a valid email address to the donor's CRM profile.");
        const rendered = renderNotificationEmail({ title: `Donation receipt ${gift.receiptNumber}`, bodyHtml: "Thank you for supporting our work. Your donation receipt is attached." });
        // Durable outbox reads only this generated file from private storage when delivering.
        await enqueueEmail(tx, { ...rendered, to: String(email.value), workspaceId, fundingReceipt: { recordId: gift.id, fileId: gift.receiptFileId, contactId: donor.id } });
        await tx.fundingRecord.updateMany({ where: { workspaceId, id: gift.id }, data: { receiptEmailedAt: new Date() } });
        await audit(actor, tx, gift, "receipt_email_queued"); return { id: gift.id };
      }
      if (gift.receiptFileId) return { id: gift.id };
      const d = detailSchemas.DONATION.parse(gift.details);
      ensure(gift.currency === "INR" && d.mode !== "IN_KIND", "80G receipt generation supports monetary INR gifts. Keep a manual receipt note for other gifts.");
      const settings = await tx.fundingRecord.findFirst({ where: { workspaceId, kind: "RECEIPT_SETTINGS", key: "settings", archivedAt: null } }); ensure(settings, "Save the organisation's receipt details first.");
      const s = detailSchemas.RECEIPT_SETTINGS.parse(settings.details);
      const profile = await tx.fundingRecord.findFirst({ where: { workspaceId, kind: "DONOR", contactId: donor.id, archivedAt: null } });
      const p = profile ? detailSchemas.DONOR.parse(profile.details) : null;
      const donorPan = d.pan || p?.pan; const address = d.donorAddress || p?.address;
      ensure(donorPan && address && gift.dateOn, "Add the donor PAN, address and gift date before generating a receipt.");
      if (d.foreignSource) ensure(s.registrationFCRA, "Add the organisation's FCRA reference before receipting a foreign-source gift.");
      const receiptNumber = d.receiptNumber || `${s.receiptPrefix}${String(await nextWorkspaceSequence(tx, workspaceId, "funding_receipt")).padStart(6, "0")}`;
      const amount = formatMoney(gift.amountMinor, gift.currency);
      const body = await createFundingPdf(`Donation receipt ${receiptNumber}`, [s.organisationName, s.address, `PAN: ${s.pan}\n12A / 12AB: ${s.registration12A || "Not recorded"}\n80G approval: ${s.registration80G}`, `Donor: ${donor.displayName}\nPAN: ${donorPan}\nAddress: ${address}`, `Received on: ${formatDate(gift.dateOn!, "UTC")}\nAmount: ${amount}\nIn words: ${rupeesInWords(gift.amountMinor)}\nMode: ${d.mode}\nReference: ${d.reference || "Not recorded"}`, `Foreign source: ${d.foreignSource ? "Yes" : "No"}${d.foreignSource ? ` · FCRA: ${s.registrationFCRA}` : ""}`, d.receiptNote, `Authorised signatory: ${s.signatory}\nPrepared on: ${formatDate(new Date(), actor.workspace.timezone)}`, "Donation receipt with organisation registration details. Confirm applicable tax treatment and obtain the prescribed filing certificate separately."]);
      ensure(await tx.fundingAttachment.count({ where: { workspaceId, recordId, file: { deletedAt: null } } }) < 20, "Remove an unused attachment to make space for the receipt.");
      const uploaded = await uploadWorkspaceFile({ workspaceId, uploadedById: actor.user.id, folder: "/funding", file: new File([new Uint8Array(body)], `receipt-${receiptNumber.replaceAll("/", "-")}.pdf`, { type: "application/pdf" }), client: tx }); ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error); storageKey = uploaded.file.storageKey;
      await tx.fundingAttachment.create({ data: { workspaceId, recordId, fileId: uploaded.file.id, generated: true } });
      await tx.fundingRecord.update({ where: { workspaceId_id: { workspaceId, id: recordId } }, data: { receiptFileId: uploaded.file.id, receiptNumber, details: { ...d, receiptNumber, receiptIssued: true } } });
      await audit(actor, tx, gift, "receipt_generated"); return { id: gift.id };
    }, { timeout: 30000 });
  } catch (e) { if (storageKey) await deleteObjects([storageKey]).catch(() => undefined); throw e; }
}
