import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { makePayslipPdf, makeReportPdf } from "@/lib/finance/tools/pdf";

describe("finance PDF documents", () => {
  it("embeds the app font and creates a private A4 payslip", async () => {
    const body = await makePayslipPdf({
      workspaceName: "Space Works community office",
      person: "Asha Menon - programme coordinator",
      kind: "Staff",
      month: "2026-06",
      currency: "INR",
      status: "Paid",
      grossMinor: 10000000,
      allowancesMinor: 1000000,
      pfMinor: 100000,
      esiMinor: 50000,
      ptMinor: 20000,
      tdsMinor: 500000,
      advancesMinor: 1000000,
      otherMinor: 30000,
      paidOn: "2026-06-30",
      reference: "UTR-20260630-COMMUNITY-OFFICE-PAYROLL",
    });
    const doc = await PDFDocument.load(body);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28);
    expect(doc.getTitle()).toBe("Payslip 2026-06");
    if (process.env.FINANCE_PDF_QA === "1") {
      await mkdir("tmp/pdfs", { recursive: true });
      await writeFile("tmp/pdfs/finance-payslip.pdf", body);
    }
  }, 30000);
  it("paginates long finance reports and keeps long names within the page", async () => {
    const body = await makeReportPdf({
      workspaceName: "Space Works community office",
      title: "Finance report",
      subtitle: "1 June to 30 June 2026 | INR",
      sections: [
        {
          title: "Income by source",
          rows: [
            [
              "Donation",
              "In INR 50,000.00",
              "Out INR 0.00",
              "Net INR 50,000.00",
            ],
          ],
        },
        {
          title: "Long variance note",
          rows: [
            [
              "Office programme",
              "Follow-up details. ".repeat(400),
              "End-of-note marker",
            ],
          ],
        },
        {
          title: "Entries and receipt references",
          rows: Array.from({ length: 70 }, (_, i) => [
            "2026-06-10",
            `Entry ${i + 1}: Community repair programme supplies`,
            "Kochi Workshop Supplies Cooperative",
            "INR 1,250.00",
            `Receipt: /api/files/receipt-${i + 1}`,
          ]),
        },
      ],
    });
    const doc = await PDFDocument.load(body);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getPages().every((p) => p.getHeight() > 840)).toBe(true);
    if (process.env.FINANCE_PDF_QA === "1") {
      await mkdir("tmp/pdfs", { recursive: true });
      await writeFile("tmp/pdfs/finance-report.pdf", body);
    }
  }, 30000);
});
