import { describe, expect, it } from "vitest";
import { advanceDate, csv, date, detailSchemas, quarterEnd, recordSchema } from "@/lib/funding/schema";
import { donationSummary, pledgeDue, progress, rupeesInWords, runway, type MoneyGift } from "@/lib/funding/analytics";
import { canManageFunding, canViewFunding } from "@/lib/roles";
const gift = (id: string, amountMinor = 10000, extra: Partial<MoneyGift> = {}): MoneyGift => ({ id, contactId: "donor", dateOn: new Date("2026-04-01"), amountMinor, currency: "INR", status: "RECEIVED", details: { mode: "BANK" }, ...extra });
describe("funding tools", () => {
  it("restricts donor and funding capabilities to admins", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const) {
      expect(canViewFunding({ role })).toBe(["OWNER", "ADMIN"].includes(role));
      expect(canManageFunding({ role })).toBe(["OWNER", "ADMIN"].includes(role));
    }
    expect(canViewFunding(null)).toBe(false); expect(canManageFunding(undefined)).toBe(false);
  });
  it("validates calendar dates and quarter ends", () => { expect(date.safeParse("2026-02-30").success).toBe(false); expect(quarterEnd("2026-Q1")).toBe("2026-03-31"); expect(advanceDate("2024-02-29", 12)).toBe("2025-02-28"); expect(advanceDate("2026-01-31", 1)).toBe("2026-02-28"); });
  it("rejects invalid PAN and unknown detail values", () => { expect(detailSchemas.DONOR.safeParse({ pan: "bad" }).success).toBe(false); expect(detailSchemas.DONOR.parse({ pan: "abcde1234f", secret: "x" })).toEqual({ pan: "ABCDE1234F", address: "" }); });
  it("requires correct links, dates, positive amounts and stage", () => { expect(recordSchema.safeParse({ kind: "DONATION", title: "Gift", currency: "INR", status: "IDEA", details: {} }).success).toBe(false); });
  it("keeps in-kind and currencies separate and excludes void/archive", () => {
    const result = donationSummary([gift("1"), gift("2", 30, { currency: "USD" }), gift("3", 500, { details: { mode: "IN_KIND" } }), gift("4", 500, { status: "VOID" }), gift("5", 900, { archivedAt: new Date() })], new Date("2026-10-20"));
    expect(result.cash).toEqual({ INR: 10000, USD: 30 }); expect(result.inKind).toEqual({ INR: 500 }); expect(result.donors[0]!.gifts).toBe(3);
  });
  it("calculates retention, campaign totals and lapsed donors", () => {
    const result = donationSummary([gift("1", 1000000, { dateOn: new Date("2025-02-01"), details: { campaignId: "c" } }), gift("2", 10000, { dateOn: new Date("2026-02-01") }), gift("3", 10, { contactId: "lapsed", dateOn: new Date("2024-01-01") })], new Date("2026-10-20"));
    expect(result.retention).toEqual({ previousDonors: 1, retained: 1, percent: 100 }); expect(result.campaigns[0]!.cash).toEqual({ INR: 1000000 }); expect(result.donors.find(d => d.contactId === "lapsed")!.segments).toContain("Lapsed"); expect(result.donors[0]!.segments).toContain("Major");
  });
  it("allocates partial recurring gifts and clamps month ends", () => {
    const p = { id: "p", amountMinor: 10000, currency: "INR", details: { frequency: "MONTHLY", nextExpectedOn: "2026-01-31" } };
    expect(pledgeDue(p, [gift("1", 5000, { details: { pledgeId: "p" } })])).toBe("2026-01-31");
    expect(pledgeDue(p, [gift("1", 15000, { details: { pledgeId: "p" } })])).toBe("2026-02-28");
    expect(pledgeDue({ ...p, details: { ...p.details, frequency: "ONCE" } }, [gift("1", 10000, { details: { pledgeId: "p" } })])).toBeNull();
  });
  it("shows sustainable and depleted cash without infinity", () => { expect(runway(10000, 100, 2100).months).toBe(5); expect(runway(100, 100, 100).months).toBeNull(); expect(runway(0, 100, 0).months).toBe(0); expect(progress(150, 100)).toBe(100); });
  it("formats amount words including paise", () => { expect(rupeesInWords(12345678)).toBe("one lakh twenty three thousand four hundred fifty six rupees and seventy eight paise only"); });
  it("quotes CSV fields and neutralises spreadsheet formulas", () => { expect(csv([[" =SUM(A1)", 'a,"b"\nc']])).toContain('"\' =SUM(A1)","a,""b""\nc"'); });
});
