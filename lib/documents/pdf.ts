import "server-only";
import QRCode from "qrcode";
import sharp from "sharp";
import { INVOICES, label } from "./rules";
import type { DocumentSnapshot } from "./service";

import { drawDocumentBody } from "./pdf/body";
import { createDocumentLayout, type DocumentAsset } from "./pdf/layout";

export async function makeDocumentPdf(
  s: DocumentSnapshot,
  asset?: DocumentAsset,
) {
  const layout = await createDocumentLayout(s);
  const { pdf, font, ink, line, clean, paragraph, section, ensure } = layout;
  const v = s.input,
    c = s.calculation;
  if (s.profile.logoFileId && asset) {
    const a = await asset(s.profile.logoFileId);
    if (a) {
      const image = await pdf.embedPng(
        await sharp(a.body)
          .resize({ width: 160, height: 80, fit: "inside" })
          .png()
          .toBuffer(),
      );
      const d = image.scaleToFit(90, 38);
      layout.page.drawImage(image, {
        x: 460,
        y: 790,
        width: d.width,
        height: d.height,
      });
    }
  }
  drawDocumentBody(s, layout);
  if (s.evidence) {
    section("Imported IRP evidence");
    paragraph(`IRN: ${s.evidence.irn}`);
    paragraph(
      `Acknowledgement: ${s.evidence.acknowledgement} | ${s.evidence.acknowledgementAt}`,
    );
    paragraph(
      "Official signed QR and signed JSON are retained with this record. This document was registered manually.",
    );
    if (s.evidence.qrFileId && asset) {
      const qr = await asset(String(s.evidence.qrFileId));
      if (qr) {
        ensure(120);
        const image = await pdf.embedPng(
          await sharp(qr.body)
            .resize(400, 400, { fit: "inside" })
            .png()
            .toBuffer(),
        );
        const d = image.scaleToFit(105, 105);
        layout.page.drawImage(image, {
          x: 40,
          y: layout.y - 105,
          width: d.width,
          height: d.height,
        });
        layout.y -= 115;
        paragraph(
          "Official imported IRP QR — separate from payment instructions.",
        );
      }
    }
  }
  if (v.ewayReference) paragraph(`E-way bill: ${v.ewayReference}`);
  if (v.notes) {
    section("Notes and terms");
    paragraph(v.notes);
  }
  if (s.profile.paymentInstructions) paragraph(s.profile.paymentInstructions);
  if (
    v.currency === "INR" &&
    s.profile.upi &&
    s.profile.upiVerified &&
    (INVOICES.includes(v.type) ||
      ["PAYMENT_RECEIPT", "GENERIC_RECEIPT"].includes(v.type))
  ) {
    ensure(125);
    const qr = await pdf.embedPng(
      await QRCode.toBuffer(
        `upi://pay?${new URLSearchParams({ pa: s.profile.upi, pn: String(s.identity.name), am: (c.totalMinor / 100).toFixed(2), cu: "INR", tn: s.number })}`,
        { width: 240, margin: 2 },
      ),
    );
    layout.page.drawImage(qr, { x: 40, y: layout.y - 90, width: 90, height: 90 });
    layout.y -= 105;
    paragraph(
      `UPI payment instruction: ${s.profile.upi}. Confirm payment manually.`,
    );
  }
  section("Authorised signatory");
  if (s.signatory.signatureFileId && asset) {
    const a = await asset(String(s.signatory.signatureFileId));
    if (a) {
      ensure(65);
      const im = await pdf.embedPng(
        await sharp(a.body)
          .resize({ width: 300, height: 100, fit: "inside" })
          .png()
          .toBuffer(),
      );
      const d = im.scaleToFit(140, 45);
      layout.page.drawImage(im, {
        x: 40,
        y: layout.y - 45,
        width: d.width,
        height: d.height,
      });
      layout.y -= 55;
    }
  }
  paragraph(`${s.signatory.name} | ${s.signatory.designation}`, true);
  paragraph(
    "Signature image is a visual mark, not a cryptographic digital signature.",
    false,
    8,
  );
  for (const [i, p] of pdf.getPages().entries()) {
    p.drawLine({
      start: { x: 40, y: 52 },
      end: { x: 551, y: 52 },
      thickness: 0.5,
      color: line,
    });
    p.drawText(
      clean(
        `${s.profile.footer || "Retain with your organisation records."} | Template ${s.templateVersion}`,
      ).slice(0, 110),
      { x: 40, y: 38, font, size: 8, color: ink },
    );
    p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
      x: 510,
      y: 24,
      font,
      size: 8,
      color: ink,
    });
  }
  pdf.setTitle(`${label(v.type)} ${s.number}`);
  pdf.setProducer("Space Works Workspace");
  return Buffer.from(await pdf.save());
}
