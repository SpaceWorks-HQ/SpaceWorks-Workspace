import { describe, expect, it } from "vitest";
import { parseCsv, exportCsv, exportVCard, duplicateContacts, duplicateOrganisations, normalizeDomain } from "@/lib/contacts/formats";
import { weeklyShiftInstances } from "@/lib/rota/schedule";
import { coverage, hasShiftConflict } from "@/lib/rota/coverage";
import { availabilityStrip, dayRange, overlaps } from "@/lib/people/availability";
import { buildRunItems, emptyOffboardingSources, offboardingItems, parseTemplateItems, runProgress, templateItemsSchema } from "@/lib/people/checklistItems";
import { canSeeAvailability, canSeeTeam } from "@/lib/people/access";
const period = (start: string, end: string) => ({ startsAt: new Date(start), endsAt: new Date(end) });
describe("relationship transfer formats", () => {
  it("reads quoted commas, quotes, CRLF, BOM and multiline cells", () => {
    expect(parseCsv('\uFEFFname,notes\r\n"Ada, Maker","She said ""hello""\nnext line"\r\n')).toEqual([["name", "notes"], ["Ada, Maker", 'She said "hello"\nnext line']]);
  });
  it.each(['name\n"unfinished', 'name\n"closed"tail', 'na"me'])("rejects malformed CSV %s", value => expect(() => parseCsv(value)).toThrow());
  it("round-trips punctuation and neutralises spreadsheet formulas", () => {
    const rows = [["Name", "Note"], ["Maker, A", 'A "quote"'], ["=2+2", " @SUM(1)"]];
    expect(parseCsv(exportCsv(rows))).toEqual([rows[0], rows[1], ["'=2+2", "' @SUM(1)"]]);
  });
  it("limits import size", () => expect(() => parseCsv("x".repeat(2_000_001))).toThrow());
  it("bounds quoted cells", () => expect(() => parseCsv(`name\n"${"x".repeat(20001)}"`)).toThrow());
  it("bounds the final row columns", () => expect(() => parseCsv(Array(42).fill("x").join(","))).toThrow());
  it("limits rows", () => expect(() => parseCsv("name\n" + "Ada\n".repeat(2001))).toThrow());
  it("escapes vCard text and prevents property injection", () => {
    const card = exportVCard({ id: "1", displayName: "Ada; Maker, A\nTEL:evil", email: "ada@example.test", phone: "+911234567890" });
    expect(card).toContain("FN:Ada\\; Maker\\, A\\nTEL:evil\r\n");
    expect(card).toContain("VERSION:3.0\r\n");
    expect(card).not.toContain("\r\nTEL:evil");
  });
  it("folds UTF-8 vCard lines at 75 octets", () => {
    const card = exportVCard({ id: "1", displayName: "മ".repeat(90) });
    for (const line of card.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(card).toContain("\r\n ");
  });
});
describe("duplicate detection", () => {
  const contacts = [{ id: "a", displayName: "Ada Maker", email: "ADA@example.test", phone: "+91 1234567890" }];
  it("normalises email case", () => expect(duplicateContacts({ displayName: "Other", email: " ada@EXAMPLE.test " }, contacts)).toHaveLength(1));
  it("normalises phone formatting", () => expect(duplicateContacts({ displayName: "Other", phone: "911234567890" }, contacts)).toHaveLength(1));
  it("normalises names", () => expect(duplicateContacts({ displayName: " ada  maker " }, contacts)).toHaveLength(1));
  it("does not match absent contact details", () => expect(duplicateContacts({ displayName: "Grace" }, contacts)).toEqual([]));
  it("matches organisation domains across scheme and www", () => {
    expect(normalizeDomain("https://www.example.test/path")).toBe("example.test");
    expect(duplicateOrganisations({ name: "Other", website: "http://www.example.test" }, [{ id: "1", name: "Partner", domain: "example.test" }])).toHaveLength(1);
  });
});
describe("rota coverage", () => {
  it("preserves weekly local hours across daylight saving changes", () => {
    const shifts = weeklyShiftInstances({ startsAt: "2030-03-03T10:00", endsAt: "2030-03-03T12:00", weeks: 2 }, "America/New_York")!;
    expect(shifts.map(s => s.startsAt.toISOString())).toEqual(["2030-03-03T15:00:00.000Z", "2030-03-10T14:00:00.000Z"]);
  });
  it("rejects repeats at nonexistent local times before any shifts are written", () => {
    expect(weeklyShiftInstances({ startsAt: "2030-03-03T02:30", endsAt: "2030-03-03T04:30", weeks: 2 }, "America/New_York")).toBeNull();
  });
  it("counts active seats and excludes cancellations", () => expect(coverage(3, [{ status: "CONFIRMED" }, { status: "SWAP_REQUESTED" }, { status: "CANCELLED" }])).toEqual({ filled: 2, open: 1, covered: false }));
  it("does not show negative gaps", () => expect(coverage(1, [{ status: "CONFIRMED" }, { status: "ATTENDED" }]).open).toBe(0));
  it("allows touching shifts and rejects overlapping ones", () => {
    const held = [period("2030-01-01T08:00Z", "2030-01-01T10:00Z")];
    expect(hasShiftConflict(held, period("2030-01-01T10:00Z", "2030-01-01T12:00Z"))).toBe(false);
    expect(hasShiftConflict(held, period("2030-01-01T09:59Z", "2030-01-01T12:00Z"))).toBe(true);
  });
});
describe("availability", () => {
  it("uses half-open intervals", () => expect(overlaps(period("2030-01-01T08:00Z", "2030-01-01T10:00Z"), period("2030-01-01T10:00Z", "2030-01-01T12:00Z"))).toBe(false));
  it("uses workspace day boundaries through DST", () => {
    const p = dayRange("2030-03-10", "2030-03-10", "America/New_York");
    expect(p.endsAt.getTime() - p.startsAt.getTime()).toBe(23 * 3600000);
  });
  it("places periods on a team strip", () => {
    const rows = availabilityStrip([{ id: "a" }, { id: "b" }], [{ userId: "a", ...dayRange("2030-01-02", "2030-01-02", "Asia/Kolkata") }], ["2030-01-01", "2030-01-02"], "Asia/Kolkata");
    expect(rows.map(r => r.awayDays)).toEqual([1, 0]);
  });
  it("hides private periods and respects team sharing", () => {
    const viewer = { role: { role: "MEMBER" as const }, userId: "a", teamIds: ["t"] };
    expect(canSeeAvailability(viewer, { userId: "b", visibility: "PRIVATE", ownerTeamIds: ["t"] })).toBe(false);
    expect(canSeeAvailability(viewer, { userId: "b", visibility: "TEAM", ownerTeamIds: ["t"] })).toBe(true);
    expect(canSeeTeam(viewer.role, { visibility: "PRIVATE" }, false)).toBe(false);
  });
});
describe("checklist generation", () => {
  it("reads normalised stored templates without losing null fields", () => {
    const items = templateItemsSchema.parse([{ title: "Meet the crew" }]);
    expect(parseTemplateItems(JSON.parse(JSON.stringify(items)))).toEqual(items);
    expect(buildRunItems(items, { startAt: new Date("2030-01-01T00:00Z"), resolve: () => "member" })[0]).toMatchObject({ assigneeId: "member", title: "Meet the crew", required: true });
  });
  it("generates record-linked handovers and deduplicates rotations", () => {
    const sources = emptyOffboardingSources();
    sources.vaultItemsToRotate = [{ id: "secret", title: "Shared login" }, { id: "secret", title: "Shared login" }];
    sources.servicesOwned = [{ id: "service", name: "Website", backup: false }];
    sources.accessCredentials = [{ id: "key", label: "Front door", type: "KEY" }];
    sources.identityLinks = [{ id: "identity", provider: "TELEGRAM", username: null }];
    const items = offboardingItems(sources, { adminId: "admin", dueAt: null });
    expect(items).toHaveLength(4);
    expect(items.map(i => i.sourceType)).toEqual(["vault_item", "service", "access_credential", "identity_link"]);
    expect(items.every(i => i.assigneeId === "admin" && i.required)).toBe(true);
  });
  it("requires only mandatory items for completion", () => {
    expect(runProgress([{ doneAt: new Date(), required: true }, { doneAt: null, required: false }])).toEqual({ done: 1, total: 2, requiredLeft: 0, complete: true });
    expect(runProgress([{ doneAt: null, required: true }]).complete).toBe(false);
  });
});
