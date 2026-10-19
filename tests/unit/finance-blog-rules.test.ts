import { describe, expect, it } from "vitest";
import { formatMoney, parseMoneyToMinor } from "@/lib/format/money";
import { csvCell, isValidIsoDate, ledgerToCsv, parseCsv, validateLedgerImport } from "@/lib/finance/csv";
import { dateOnly, localDate, monthKeys } from "@/lib/finance/dates";
import { parseLedgerFilters } from "@/lib/finance/filters";
import { canTransition, formatInvoiceNumber, isInvoiceOverdue } from "@/lib/finance/invoice";
import { invoiceTotals, isNegativeMoney, ledgerTotals, lineSubtotalMinor, MAX_AMOUNT_MINOR, minorToDecimalString, parsePercentToBps, runningBalances } from "@/lib/finance/money";
import { invoiceSchema } from "@/lib/finance/schemas";
import { buildRssFeed, buildSitemap, buildSitemapIndex, escapeXml } from "@/lib/blog/feed";
import { htmlToText, postSlugFromTitle, postSlugProblem, postState, uniquePostSlug } from "@/lib/blog/rules";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";

const categories = [{ id: "expense-cat", name: "Tools", kind: "EXPENSE" as const }];
const header = ["date", "kind", "amount", "currency", "category", "description", "counterparty"];

describe("finance money and invoices", () => {
  it("formats INR with Indian grouping and handles zero/three decimal currencies", () => {
    expect(formatMoney(123456789)).toBe("₹12,34,567.89");
    expect(minorToDecimalString(125, "JPY")).toBe("125");
    expect(minorToDecimalString(-125, "KWD")).toBe("-0.125");
    expect(parseMoneyToMinor("1,250.50")).toBe(125050);
    expect(parseMoneyToMinor("0.001", "KWD")).toBe(1);
    expect(parseMoneyToMinor("1.1", "JPY")).toBeNull();
    expect(parseMoneyToMinor("1.001", "INR")).toBeNull();
  });
  it.each(["-5", "₹-5", "−5", "(5)"])("rejects negative financial input %s", (value) => expect(isNegativeMoney(value)).toBe(true));
  it("caps amounts at the database range", () => expect(MAX_AMOUNT_MINOR).toBe(2 ** 31 - 1));
  it("totals and running balances exclude voids", () => {
    const entries = [{ kind: "INCOME" as const, amountMinor: 1000 }, { kind: "EXPENSE" as const, amountMinor: 250 }, { kind: "EXPENSE" as const, amountMinor: 400, voidedAt: "2026-01-01" }];
    expect(ledgerTotals(entries)).toEqual({ incomeMinor: 1000, expenseMinor: 250, netMinor: 750, count: 2 });
    expect(runningBalances(entries, 100)).toEqual([1100, 850, 850]);
  });
  it("rounds once per line, then applies basis-point tax", () => {
    const items = [{ description: "Bench time", quantity: 1.5, unitMinor: 101, taxBps: 1800 }, { description: "Parts", quantity: 2, unitMinor: 99 }];
    expect(lineSubtotalMinor(items[0]!)).toBe(152);
    expect(invoiceTotals(items)).toEqual({ subtotalMinor: 350, taxMinor: 27, totalMinor: 377 });
  });
  it("validates tax, quantities, dates and numbering", () => {
    expect(parsePercentToBps("12.5%")).toBe(1250);
    expect(parsePercentToBps("100.01")).toBeNull();
    expect(formatInvoiceNumber(12)).toBe("INV-0012");
    expect(invoiceSchema.safeParse({ clientName: "Maker", issuedOn: "2026-10-19", dueOn: "2026-10-18", items: [{ description: "Parts", quantity: 1.001, unitPrice: "1" }] }).success).toBe(false);
  });
  it("enforces invoice transitions and overdue date boundaries", () => {
    expect(canTransition("DRAFT", "PAID")).toBe(false);
    expect(canTransition("SENT", "PAID")).toBe(true);
    expect(canTransition("VOID", "PAID")).toBe(false);
    expect(isInvoiceOverdue({ status: "SENT", dueOn: dateOnly("2026-10-19") }, "2026-10-19")).toBe(false);
    expect(isInvoiceOverdue({ status: "SENT", dueOn: dateOnly("2026-10-19") }, "2026-10-20")).toBe(true);
  });
  it("uses the workspace calendar day and crosses year boundaries", () => {
    expect(localDate(new Date("2026-10-19T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-20");
    expect(monthKeys("2026-01-19", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(parseLedgerFilters({ from: "2026-10-20", to: "2026-10-01", page: "-1" })).toMatchObject({ from: "2026-10-01", to: "2026-10-20", page: 1 });
  });
});

describe("finance CSV", () => {
  it("reads BOM, quoted commas, quotes, newlines and CRLF", () => {
    expect(parseCsv('\uFEFFa,b\r\n"one, two","a ""quote""\nand line"\r\n')).toEqual({ ok: true, rows: [["a", "b"], ["one, two", 'a "quote"\nand line']] });
    expect(parseCsv('a,"unclosed')).toMatchObject({ ok: false });
  });
  it("rejects malformed quoted fields instead of silently changing them", () => {
    expect(parseCsv('a,b\n"one"garbage,two')).toMatchObject({ ok: false });
    expect(parseCsv('a,b\none"two,three')).toMatchObject({ ok: false });
  });
  it("prevents spreadsheet formulas and preserves plain numeric cells", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(" +SUM(A1)")).toContain("' +SUM");
    expect(csvCell(-12.5)).toBe("-12.5");
  });
  it("round trips an exported ledger", () => {
    const csv = ledgerToCsv([{ occurredOn: dateOnly("2026-10-19"), kind: "EXPENSE", amountMinor: 125050, currency: "INR", categoryName: "Tools", description: 'Pliers, "small"', counterparty: "Shop" }]);
    const parsed = parseCsv(csv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateLedgerImport(parsed.rows, { currency: "INR", categories })).toMatchObject({ ok: true, problems: [], rows: [{ amountMinor: 125050, categoryId: "expense-cat", description: 'Pliers, "small"' }] });
  });
  it.each([
    ["2026-02-30", "expense", "1", "INR", "Tools", "Parts", ""],
    ["2026-10-19", "expense", "-1", "INR", "Tools", "Parts", ""],
    ["2026-10-19", "expense", "21474836.48", "INR", "Tools", "Parts", ""],
    ["2026-10-19", "expense", "1", "USD", "Tools", "Parts", ""],
    ["2026-10-19", "income", "1", "INR", "Tools", "Parts", ""],
    ["2026-10-19", "expense", "1", "INR", "Missing", "", ""],
  ])("reports invalid import row %j", (...row) => {
    const result = validateLedgerImport([header, row], { currency: "INR", categories });
    expect(result).toMatchObject({ ok: true, rows: [], problems: [{ line: 2 }] });
  });
  it("rejects archived categories, missing/duplicate headers and empty files", () => {
    expect(validateLedgerImport([header, ["2026-10-19", "expense", "1", "INR", "Tools", "Parts", ""]], { currency: "INR", categories: [{ ...categories[0]!, archived: true }] })).toMatchObject({ problems: [{ line: 2 }] });
    expect(validateLedgerImport([], { currency: "INR", categories })).toMatchObject({ ok: false });
    expect(validateLedgerImport([["date", "amount"]], { currency: "INR", categories })).toMatchObject({ ok: false });
    expect(validateLedgerImport([[...header, "amount"], ["2026-10-19", "expense", "1", "INR", "", "Parts", "", "2"]], { currency: "INR", categories })).toMatchObject({ ok: false });
    expect(isValidIsoDate("2024-02-29")).toBe(true);
  });
});

describe("blog slugs and sanitisation", () => {
  it("normalises titles and avoids reserved or occupied addresses", () => {
    expect(postSlugFromTitle("A night at the workbench!")).toBe("a-night-at-the-workbench");
    expect(postSlugProblem("Upper-Case")).not.toBeNull();
    expect(postSlugProblem("rss")).not.toBeNull();
    expect(uniquePostSlug("rss", new Set())).toBe("rss-post");
    expect(uniquePostSlug("build", new Set(["build", "build-2"]))).toBe("build-3");
    const base = "a".repeat(60);
    const next = uniquePostSlug(base, new Set([base]));
    expect(next).toHaveLength(60);
    expect(postSlugProblem(next)).toBeNull();
  });
  it("distinguishes scheduled drafts from public posts", () => {
    expect(postState({ status: "DRAFT", publishedAt: null })).toBe("Draft");
    expect(postState({ status: "DRAFT", publishedAt: new Date(0) })).toBe("Scheduled");
    expect(postState({ status: "PUBLISHED", publishedAt: new Date(0) })).toBe("Published");
  });
  it("removes executable markup and unsafe URLs", () => {
    const clean = sanitizeBlogHtml('<h1>Build</h1><script>alert(1)</script><img src=x onerror=alert(1)><iframe>bad</iframe><p style="color:red" onclick="bad()">Safe <a href="javascript:alert(1)">link</a></p>');
    expect(clean).toBe('<h2>Build</h2><p>Safe <a>link</a></p>');
    expect(htmlToText(clean)).toBe("Build Safe link");
  });
  it("keeps safe formatting and protects outbound links", () => {
    const clean = sanitizeBlogHtml('<p><strong>Parts</strong> <a href="https://example.test">read</a> <a href="/blog/makers">home</a></p>');
    expect(clean).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(clean).toContain('<a href="/blog/makers">home</a>');
    expect(sanitizeBlogHtml(clean)).toBe(clean);
  });
});

describe("blog XML", () => {
  it("escapes XML markup, attributes and forbidden control characters", () => {
    expect(escapeXml('<x a="1">&\'\u0001')).toBe("&lt;x a=&quot;1&quot;&gt;&amp;&apos;");
  });
  it("does not allow titles, authors or descriptions to insert RSS elements", () => {
    const xml = buildRssFeed({ title: "Makers & friends", url: "https://example.test/blog", feedUrl: "https://example.test/rss?a=1&b=2", description: "News" }, [{ title: "</title><script>bad</script>", url: "https://example.test/post", description: "<b>Parts</b>", author: "A & B", publishedAt: new Date("2026-10-19T00:00:00Z") }]);
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;/title&gt;&lt;script&gt;bad&lt;/script&gt;");
    expect(xml).toContain("<dc:creator>A &amp; B</dc:creator>");
    expect(xml).toContain("Mon, 19 Oct 2026");
    expect(buildSitemap([{ url: "https://example.test/?a=1&b=2", lastModified: new Date(0) }])).toContain("?a=1&amp;b=2</loc>");
    expect(buildSitemapIndex(["https://example.test/sitemap.xml?page=1&a=2"])).toContain("<sitemap><loc>https://example.test/sitemap.xml?page=1&amp;a=2</loc></sitemap>");
  });
});
