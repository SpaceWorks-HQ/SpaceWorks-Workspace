import "server-only";
import { readFile } from "node:fs/promises";
import { DocumentsError } from "./access";
import path from "node:path";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import sharp from "sharp";
import {
  label,
  inrWords,
  LETTERS,
  INVOICES,
  donationForm,
  financialYear,
} from "./rules";
import type { DocumentSnapshot } from "./service";
import { formatMoney, currencyMinorDigits } from "@/lib/format/money";

/** A4, Gilroy, Deep Ink/Maker Teal/Warm Cream from the Space Works brand. */
export async function makeDocumentPdf(
  s: DocumentSnapshot,
  asset?: (id: string) => Promise<{ body: Uint8Array } | null>,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Regular.woff"),
    ),
    { subset: true, features: { liga: false } },
  );
  const bold = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Bold.woff"),
    ),
    { subset: true, features: { liga: false } },
  );
  const ink = rgb(20 / 255, 44 / 255, 42 / 255),
    teal = rgb(0, 110 / 255, 99 / 255),
    cream = rgb(1, 244 / 255, 232 / 255),
    line = rgb(0.78, 0.83, 0.81);
  const chars = new Set(font.getCharacterSet());
  const clean = (s: string) => {
    const text = s.replace(/[\u00a0\t\r]/g, " ");
    if ([...text].some((c) => !chars.has(c.codePointAt(0)!)))
      throw new DocumentsError(
        "The PDF font cannot render part of this text. Use supported wording or retain an externally prepared copy as a source file.",
      );
    return text;
  };
  let page: PDFPage,
    y = 0;
  const v = s.input,
    c = s.calculation;
  const money = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: v.currency,
      currencyDisplay: "code",
    })
      .format(n / 10 ** currencyMinorDigits(v.currency))
      .replaceAll("\u00a0", " ");
  const next = () => {
    page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 748,
      width: 595.28,
      height: 94,
      color: cream,
    });
    page.drawText("Space Works Workspace", {
      x: 40,
      y: 810,
      font: bold,
      size: 10,
      color: teal,
    });
    page.drawText(
      clean(
        ["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type) && !v.gstAdjustment
          ? `Commercial ${label(v.type).toLowerCase()}`
          : label(v.type),
      ),
      {
        x: 40,
        y: 781,
        font: bold,
        size: 19,
        color: ink,
      },
    );
    page.drawText(clean(`${s.number} | ${v.issuedOn}`), {
      x: 40,
      y: 759,
      font,
      size: 10,
      color: ink,
    });
    y = 720;
  };
  const ensure = (height = 22) => {
    if (y - height < 65) next();
  };
  const paragraph = (text: string, strong = false, size = 10) => {
    for (const p of text.split("\n")) {
      let current = "";
      const f = strong ? bold : font;
      for (const word of clean(p).split(/\s+/)) {
        const candidate = current ? current + " " + word : word;
        if (f.widthOfTextAtSize(candidate, size) > 510 && current) {
          ensure(size + 8);
          page.drawText(current, { x: 40, y, font: f, size, color: ink });
          y -= size + 6;
          current = word;
        } else current = candidate;
        while (f.widthOfTextAtSize(current, size) > 510) {
          let n = current.length - 1;
          while (n > 1 && f.widthOfTextAtSize(current.slice(0, n), size) > 510)
            n--;
          ensure(size + 8);
          page.drawText(current.slice(0, n), {
            x: 40,
            y,
            font: f,
            size,
            color: ink,
          });
          y -= size + 6;
          current = current.slice(n);
        }
      }
      if (current) {
        ensure(size + 8);
        page.drawText(current, { x: 40, y, font: f, size, color: ink });
        y -= size + 6;
      }
    }
    y -= 5;
  };
  const section = (name: string) => {
    ensure(50);
    y -= 8;
    paragraph(name, true, 12);
  };
  next();
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
      page!.drawImage(image, {
        x: 460,
        y: 790,
        width: d.width,
        height: d.height,
      });
    }
  }
  paragraph(String(s.identity.name), true, 15);
  paragraph(String(s.identity.address || ""));
  paragraph(
    [
      s.identity.registration && `Registration: ${s.identity.registration}`,
      s.identity.pan && `PAN: ${s.identity.pan}`,
      s.identity.tan && `TAN: ${s.identity.tan}`,
      s.profile.cin && `CIN: ${s.profile.cin}`,
      s.profile.contact,
    ]
      .filter(Boolean)
      .join(" | "),
  );
  if (s.registration.identifier)
    paragraph(
      `${s.registration.kind}: ${s.registration.identifier} | ${s.registration.address || ""}`,
    );
  section("Recipient");
  paragraph(v.partyName, true, 12);
  paragraph(v.partyAddress);
  if (v.partyTaxId) paragraph(`Recipient tax ID: ${v.partyTaxId}`);
  if (v.deliveryAddress) paragraph(`Delivery: ${v.deliveryAddress}`);
  if (v.dueOn) paragraph(`Due: ${v.dueOn}`);
  if (v.supplyOn) paragraph(`Supply / tax point: ${v.supplyOn}`);
  if (v.placeOfSupply)
    paragraph(
      `Place of supply: ${v.placeOfSupply} | Rule: ${v.placeRule} | ${v.supplyCategory}`,
    );
  if (v.componentOverride)
    paragraph(
      `Reviewed tax override: ${v.componentOverride} | ${v.overrideReason}`,
    );
  if (Array.isArray(s.source.noteAllocations))
    for (const original of s.source.noteAllocations as Array<{
      number: string;
      date: string;
      amountMinor: number;
    }>)
      paragraph(
        `Original: ${original.number} | ${original.date} | Adjustment: ${money(original.amountMinor)}`,
      );
  if (v.parentId)
    paragraph(
      `Original document: ${String(s.source.originalNumber || v.parentId)}`,
    );
  if (LETTERS.includes(v.type)) {
    section(v.title);
    paragraph(s.letter, false, 12);
  } else if (v.type === "US_ACKNOWLEDGEMENT" && v.paymentMode === "IN_KIND") {
    section("Contributed property");
    for (const row of c.rows) paragraph(row.description);
    paragraph("No deductible value is assigned to contributed property.");
  } else if (c.rows.length) {
    section("Items and tax");
    for (const [index, r] of c.rows.entries()) {
      ensure(95);
      page!.drawLine({
        start: { x: 40, y: y + 5 },
        end: { x: 551, y: y + 5 },
        color: line,
        thickness: 0.5,
      });
      paragraph(`${index + 1}. ${r.description}`, true);
      paragraph(
        `${r.quantity} ${r.unit} × ${money(r.unitMinor)} | HSN/SAC ${r.hsn || "—"} | Discount ${money(r.discountMinor)}`,
      );
      paragraph(
        `Taxable ${money(r.taxableMinor)} | Rate ${r.rateBps / 100}% | CGST ${money(r.cgstMinor)} | SGST/UTGST ${money(r.sgstMinor)}`,
      );
      paragraph(
        `IGST ${money(r.igstMinor)} | VAT ${money(r.vatMinor)} | Cess ${money(r.cessMinor)}${r.exempt ? ` | Exemption: ${r.exemption}` : ""}`,
      );
    }
    section("Totals");
    paragraph(
      `Taxable: ${money(c.taxableMinor)} | CGST: ${money(c.cgstMinor)} | SGST/UTGST: ${money(c.sgstMinor)}`,
    );
    paragraph(
      `IGST: ${money(c.igstMinor)} | VAT: ${money(c.vatMinor)} | Cess: ${money(c.cessMinor)} | Round-off: ${money(c.roundOffMinor)}`,
    );
    paragraph(`Total: ${money(c.totalMinor)}`, true, 15);
    if (v.currency === "INR") paragraph(inrWords(c.totalMinor));
    if (v.reverseCharge)
      paragraph(
        "Reverse charge: Yes. Tax is payable by the recipient; it is excluded from the collectible total.",
      );
    if (v.type === "BILL_OF_SUPPLY")
      paragraph(
        s.profile.gstScheme === "COMPOSITION"
          ? "Composition taxable person, not eligible to collect tax on supplies."
          : "Exempt supply. No GST charged.",
      );
    if (v.supplyCategory !== "DOMESTIC")
      paragraph(
        v.supplyCategory.endsWith("WITHOUT_TAX")
          ? "Supply meant for export / SEZ under bond or letter of undertaking without payment of integrated tax."
          : "Supply meant for export / SEZ on payment of integrated tax.",
      );
  }
  if (v.paymentOn) {
    section("Payment record");
    paragraph(
      `Payment date: ${v.paymentOn} | Mode: ${v.paymentMode} | Reference: ${v.paymentReference}`,
    );
    if (s.source.originalPayment) {
      const original = s.source.originalPayment as {
        amountMinor: number;
        currency: string;
      };
      paragraph(
        `Original payment: ${formatMoney(original.amountMinor, original.currency)} | INR reporting basis: ${s.source.exchangeBasis}`,
      );
    }
    paragraph(
      `${["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type) ? "Cash returned" : "Actual cash"}: ${money(v.cashMinor)} | Withholding: ${money(v.tdsMinor)} | Section: ${v.tdsSection || "Not applicable"}`,
    );
  }
  if (Array.isArray(s.source.refundAllocations))
    for (const allocation of s.source.refundAllocations as Array<{
      number: string;
      cashMinor: number;
    }>)
      paragraph(
        `Cash allocation reversed: ${allocation.number} | ${money(allocation.cashMinor)}`,
      );
  if (v.type.startsWith("DONATION") || v.type === "FCRA_RECEIPT") {
    section(
      v.type === "DONATION_CERTIFICATE"
        ? `Certificate details — Form ${donationForm(v.paymentOn).certificate}`
        : "Donation acknowledgement",
    );
    paragraph(
      `Category: ${v.donationCategory} | Purpose: ${v.programme || v.title}`,
    );
    if (v.type === "DONATION_CERTIFICATE") {
      const a = s.registration.approval as Record<string, unknown>;
      paragraph(
        `Approval / URN: ${a.identifier} | Order: ${a.orderDate} | Validity: ${a.validFrom} to ${a.validTo}`,
      );
      paragraph(
        `Donor ID (${v.donorIdType}): ${v.donorId} | Section: ${v.deductionSection} | Imported portal acknowledgement / Pre-ARN: ${v.portalReference}`,
      );
      paragraph(
        `Donation year: ${financialYear(v.paymentOn)} | Filing reference: ${v.filingReference || "Awaiting filing"}`,
      );
      paragraph(
        "Deduction remains subject to applicable law and the donor's eligibility. Retain the official portal certificate with this record.",
      );
    } else
      paragraph(
        "Ordinary acknowledgement of funds received. This is not a statutory donation-deduction certificate.",
      );
    if (v.type === "FCRA_RECEIPT")
      paragraph(
        `FCRA designated account confirmed | Donor country: ${v.donorCountry} | Foreign source basis: ${v.foreignSourceBasis} | Conversion: ${v.exchangeBasis} | INR amount (minor units): ${v.inrMinor}`,
      );
  }
  if (v.type === "US_ACKNOWLEDGEMENT")
    paragraph(
      `Goods or services in return: ${v.benefits} | Good-faith benefit value: ${money(v.benefitValueMinor)}. Non-cash property is described without a deductible valuation.`,
    );
  if (v.type === "VAT_INVOICE" && s.profile.country === "GB")
    paragraph(
      `VAT payable in sterling: ${formatMoney(v.vatSterlingMinor, "GBP")}`,
    );
  if (v.type === "CSR_UC" || v.type === "GOVERNMENT_UC") {
    section(
      v.type === "GOVERNMENT_UC"
        ? "GFR 12-A working certificate — authority format review required"
        : "CSR agreement utilisation certificate",
    );
    paragraph(`Period: ${v.periodStart} to ${v.periodEnd}`);
    paragraph(v.sanction);
    paragraph(
      `Opening: ${money(v.openingMinor)} | Receipts: ${money(v.receiptsMinor)} | Interest: ${money(v.interestMinor)}`,
    );
    paragraph(
      `Expenditure: ${money(v.expenditureMinor)} | Refunds / interest returned: ${money(v.refundsMinor)} | Unadjusted advances: ${money(v.advancesMinor)}`,
    );
    paragraph(
      `Closing balance: ${money(v.openingMinor + v.receiptsMinor + v.interestMinor - v.expenditureMinor - v.refundsMinor)}`,
    );
    paragraph(v.schedules);
    paragraph(v.outcomes);
    section("Fund ledger schedule");
    for (const row of (s.source.schedule ?? []) as Array<{
      id: string;
      date: string;
      kind: string;
      amountMinor: number;
    }>)
      paragraph(
        `${row.date} | ${row.kind} | ${money(row.amountMinor)} | ${row.id}`,
      );
  }
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
        page!.drawImage(image, {
          x: 40,
          y: y - 105,
          width: d.width,
          height: d.height,
        });
        y -= 115;
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
    page!.drawImage(qr, { x: 40, y: y - 90, width: 90, height: 90 });
    y -= 105;
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
      page!.drawImage(im, {
        x: 40,
        y: y - 45,
        width: d.width,
        height: d.height,
      });
      y -= 55;
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
