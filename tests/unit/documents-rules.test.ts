import { describe, it, expect } from "vitest";
import {
  calculate,
  lineSchema,
  financialYear,
  serialNumber,
  inrWords,
  ageing,
  donationForm,
  donationReportingCodes,
  mergeLetter,
  draftSchema,
  csvCell,
  parseDocumentAmount,
} from "@/lib/documents/rules";
import {
  canIssueFinancialDocuments,
  canIssueLetters,
  canManageDocumentSettings,
  canCancelDocuments,
  canExportDocumentFilings,
} from "@/lib/roles";
const line = lineSchema.parse({
  description: "Programme support",
  quantity: "1",
  unitMinor: 1000000,
  rateBps: 1800,
});
it("rejects signed and malformed document money inputs", () => {
  expect(parseDocumentAmount("-5")).toBeNull();
  expect(parseDocumentAmount("1e3")).toBeNull();
  expect(parseDocumentAmount("1,250.50")).toBe(125050);
});
describe("Documents exact money and fiscal controls", () => {
  it("splits Kerala intra-state tax", () => {
    const c = calculate([line], "INTRA");
    expect([c.cgstMinor, c.sgstMinor, c.igstMinor, c.totalMinor]).toEqual([
      90000, 90000, 0, 1180000,
    ]);
  });
  it("uses IGST for interstate supplies", () => {
    const c = calculate([line], "INTER");
    expect([c.cgstMinor, c.sgstMinor, c.igstMinor]).toEqual([0, 0, 180000]);
  });
  it("does not charge exempt lines", () =>
    expect(calculate([{ ...line, exempt: true }], "INTRA").totalMinor).toBe(
      1000000,
    ));
  it("does not collect tax on a bill of supply", () =>
    expect(calculate([line], "NONE").igstMinor).toBe(0));
  it("supports editable 40% rates", () =>
    expect(calculate([{ ...line, rateBps: 4000 }], "INTER").totalMinor).toBe(
      1400000,
    ));
  it("keeps reverse-charge liability outside supplier collections", () => {
    const c = calculate([line], "INTER", false, true);
    expect(c.igstMinor).toBe(180000);
    expect(c.totalMinor).toBe(1000000);
  });
  it("calculates fractional quantities without float multiplication", () =>
    expect(
      calculate(
        [{ ...line, quantity: "0.125", unitMinor: 101, rateBps: 0 }],
        "NONE",
      ).totalMinor,
    ).toBe(13));
  it("discounts before applying tax and cess", () => {
    const c = calculate(
      [{ ...line, discountMinor: 100000, cessBps: 100 }],
      "INTER",
    );
    expect(c.taxableMinor).toBe(900000);
    expect(c.igstMinor).toBe(162000);
    expect(c.cessMinor).toBe(9000);
  });
  it("shows a final half-up rupee adjustment", () => {
    const c = calculate(
      [{ ...line, unitMinor: 125050, rateBps: 0 }],
      "NONE",
      true,
    );
    expect(c.roundOffMinor).toBe(50);
    expect(c.totalMinor).toBe(125100);
  });
  it("rejects over-discounting", () =>
    expect(() =>
      calculate([{ ...line, discountMinor: 1000001 }], "NONE"),
    ).toThrow("Discount"));
  it("rejects overflow across lines", () =>
    expect(() =>
      calculate([{ ...line, unitMinor: 2147483647 }, line], "NONE"),
    ).toThrow("limit"));
  it("rejects zero quantity", () =>
    expect(() => calculate([{ ...line, quantity: "0" }], "NONE")).toThrow(
      "Quantity",
    ));
  it("uses the April fiscal boundary", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });
  it("supports international fiscal years", () =>
    expect(financialYear("2026-01-01", 1)).toBe("2026-27"));
  it("validates the GST series maximum", () => {
    expect(serialNumber("TI", "2026-27", 1)).toBe("TI/2627/00001");
    expect(() => serialNumber("TOOLONG", "2026-27", 1, 6)).toThrow();
  });
  it("spells INR lakh, crore and paise", () => {
    expect(inrWords(12500050)).toBe(
      "Rupees One Lakh Twenty-Five Thousand and Fifty Paise Only",
    );
    expect(inrWords(1000000000)).toContain("One Crore");
  });
  it("calculates the ageing boundaries", () => {
    expect(ageing("2026-01-01", "2026-01-31")).toBe("0–30");
    expect(ageing("2026-01-01", "2026-02-01")).toBe("31–60");
    expect(ageing("2026-01-01", "2026-03-03")).toBe("61–90");
    expect(ageing("2026-01-01", "2026-04-02")).toBe("90+");
  });
  it("selects separate legacy and current donation adapters", () => {
    expect(donationForm("2026-03-31").statement).toBe("10BD");
    expect(donationForm("2026-04-01")).toMatchObject({
      statement: "113",
      certificate: "114",
      section: "354",
    });
  });
  it("rejects unknown merge fields", () => {
    expect(mergeLetter("Dear {{person}}", { person: "Meera" })).toBe(
      "Dear Meera",
    );
    expect(() => mergeLetter("{{salary}}", {})).toThrow();
  });
  it("neutralises spreadsheet formula text", () =>
    expect(csvCell("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"'));
  it("requires reviewed manual overrides", () => {
    const result = draftSchema.safeParse({
      type: "TAX_INVOICE",
      title: "Test",
      issuedOn: "2026-04-01",
      currency: "INR",
      partyName: "Test",
      componentOverride: "INTER",
    });
    expect(result.success).toBe(false);
  });
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)(
    "gates all statutory capabilities for %s",
    (role) => {
      for (const fn of [
        canIssueFinancialDocuments,
        canIssueLetters,
        canManageDocumentSettings,
        canCancelDocuments,
        canExportDocumentFilings,
      ])
        expect(fn({ role })).toBe(role === "OWNER" || role === "ADMIN");
    },
  );
});

it("uses distinct donor ID vocabularies by donation period", () => {
  expect(
    donationReportingCodes("2025-04-01", "PASSPORT", "SPECIFIC_GRANT", "BANK"),
  ).toMatchObject({ idCode: "4", category: "Specific grant" });
  expect(
    donationReportingCodes("2026-04-01", "PASSPORT", "SPECIFIC_GRANT", "BANK"),
  ).toMatchObject({ idCode: "2", category: "III", mode: "III" });
  expect(() =>
    donationReportingCodes("2026-04-01", "AADHAAR", "CORPUS", "CASH"),
  ).toThrow("form year");
});
