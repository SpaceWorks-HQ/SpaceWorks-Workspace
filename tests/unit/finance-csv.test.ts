import { describe, expect, it } from "vitest";
import { csvCell, ledgerToCsv, MAX_IMPORT_ROWS, parseCsv, validateLedgerImport } from "@/lib/finance/csv";

const categories = [
  { id: "cat_rent", name: "Space rent", kind: "EXPENSE" as const },
  { id: "cat_fees", name: "Workshop fees", kind: "INCOME" as const },
  { id: "cat_old", name: "Old stuff", kind: "EXPENSE" as const, archived: true },
];

function rows(text: string) {
  const parsed = parseCsv(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rows;
}

describe("CSV parsing", () => {
  it("handles quotes, doubled quotes, commas, CRLF and a BOM", () => {
    const parsed = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",3\n"multi\nline",,\n');
    expect(parsed).toEqual({ ok: true, rows: [["a", "b", "c"], ["x, y", 'say "hi"', "3"], ["multi\nline", "", ""]] });
  });

  it("drops blank lines and keeps a last line without a newline", () => {
    expect(rows("a,b\n\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("rejects an unterminated quote", () => {
    expect(parseCsv('a,"b\n1,2')).toMatchObject({ ok: false });
  });
});

describe("CSV export", () => {
  it("quotes when needed and neutralises formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('has "quotes", commas')).toBe('"has ""quotes"", commas"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell(null)).toBe("");
  });

  it("writes the ledger columns and round-trips through the importer", () => {
    const csv = ledgerToCsv([
      { occurredOn: new Date("2026-10-15T00:00:00Z"), kind: "EXPENSE", amountMinor: 800_000, currency: "INR", categoryName: "Space rent", description: "October rent", counterparty: "Landlord" },
      { occurredOn: new Date("2026-10-10T00:00:00Z"), kind: "INCOME", amountMinor: 500_050, currency: "INR", categoryName: null, description: "=cmd|' /C calc'!A0", counterparty: null },
    ]);
    expect(csv.split("\r\n")[0]).toBe("date,kind,amount,currency,category,description,counterparty");
    expect(csv).toContain("2026-10-15,expense,8000.00,INR,Space rent,October rent,Landlord");
    const preview = validateLedgerImport(rows(csv), { currency: "INR", categories });
    expect(preview).toMatchObject({ ok: true, problems: [] });
    if (!preview.ok) return;
    expect(preview.rows[0]).toMatchObject({ line: 2, kind: "EXPENSE", amountMinor: 800_000, categoryId: "cat_rent", occurredOn: "2026-10-15" });
    // The formula guard is stripped again on import.
    expect(preview.rows[1]).toMatchObject({ kind: "INCOME", amountMinor: 500_050, description: "=cmd|' /C calc'!A0", categoryId: null });
  });
});

describe("CSV import validation", () => {
  const header = "date,kind,amount,currency,category,description,counterparty";

  it("requires the core columns", () => {
    expect(validateLedgerImport(rows("date,amount\n2026-10-01,5"), { currency: "INR", categories })).toEqual({ ok: false, error: "The header row needs these columns: kind, description." });
    expect(validateLedgerImport([], { currency: "INR", categories })).toMatchObject({ ok: false });
    expect(validateLedgerImport(rows(header), { currency: "INR", categories })).toMatchObject({ ok: false });
  });

  it("reports every problem with its line number", () => {
    const csv = [
      header,
      "2026-10-01,expense,1200,INR,Space rent,Rent,Landlord",
      "2026-13-01,expense,10,INR,,Bad date,",
      "2026-10-02,transfer,10,INR,,Bad kind,",
      "2026-10-02,expense,-10,INR,,Negative,",
      "2026-10-02,expense,10.123,INR,,Too precise,",
      "2026-10-02,expense,10,USD,,Wrong currency,",
      "2026-10-02,income,10,INR,Space rent,Wrong category kind,",
      "2026-10-02,expense,10,INR,Old stuff,Archived category,",
      "2026-10-02,expense,10,INR,,,",
    ].join("\n");
    const preview = validateLedgerImport(rows(csv), { currency: "INR", categories });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ line: 2, amountMinor: 120_000, counterparty: "Landlord" });
    expect(preview.problems.map((p) => p.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(preview.problems[0]!.message).toContain("date");
    expect(preview.problems[1]!.message).toContain("income or expense");
    expect(preview.problems[2]!.message).toContain("positive");
    expect(preview.problems[4]!.message).toContain("INR");
    expect(preview.problems[5]!.message).toContain("no income category");
    expect(preview.problems[6]!.message).toContain("archived");
    expect(preview.problems[7]!.message).toContain("description");
  });

  it("matches categories case-insensitively and defaults the currency", () => {
    const preview = validateLedgerImport(rows("Date,Kind,Amount,Category,Description\n2026-10-01,Income,\"1,500\",workshop FEES,Seats"), { currency: "INR", categories });
    expect(preview).toMatchObject({ ok: true, problems: [], rows: [{ kind: "INCOME", amountMinor: 150_000, currency: "INR", categoryId: "cat_fees" }] });
  });

  it("caps the number of rows", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => "2026-10-01,expense,1,INR,,x,").join("\n");
    expect(validateLedgerImport(rows(`${header}\n${body}`), { currency: "INR", categories })).toMatchObject({ ok: false });
  });
});
