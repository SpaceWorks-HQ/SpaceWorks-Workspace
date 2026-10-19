import { describe, expect, it } from "vitest";
import { auditHtml } from "@/lib/seo/audit";
import { summariseMetrics } from "@/lib/seo/metrics";
import { normalizeEventPatterns } from "@/lib/integrations/routing/patterns";
describe("SEO audits", () => {
  it("passes a complete accessible page", () => {
    const result = auditHtml('<html lang="en"><head><title>Space Works build nights</title><meta name="description" content="Join the Space Works community for friendly build nights and shared projects in Kochi."><meta name="viewport" content="width=device-width"><link rel="canonical" href="/build"></head><body><h1>Build nights</h1><img alt="" src="bench.png"></body></html>', "https://example.org/build");
    expect(result.score).toBe(100); expect(result.findings.every(f => f.passed)).toBe(true);
  });
  it("reports missing headings, descriptions, image alternatives and noindex", () => {
    const result = auditHtml('<title>X</title><meta name="robots" content="noindex,nofollow"><img src="x">', "http://example.org");
    expect(result.score).toBe(0); expect(result.findings.find(f => f.check === "alt")?.passed).toBe(false);
  });
  it("parses entities and quoted attributes without executing markup", () => {
    expect(auditHtml('<title>Build &amp; repair nights</title><script>throw new Error()</script>', "https://example.org").findings.find(f => f.check === "title")?.passed).toBe(true);
  });
});
describe("performance aggregation", () => {
  it("uses daily site totals and weights position by impressions", () => {
    const base = { date: new Date(), query: "", page: "", ctr: 0, clicks: 10, impressions: 100, position: 2 };
    const result = summariseMetrics([base, { ...base, clicks: 30, impressions: 300, position: 6 }, { ...base, query: "makers", clicks: 50 }, { ...base, page: "https://example.org/", clicks: 80 }]);
    expect(result.totals).toEqual({ clicks: 40, impressions: 400, ctr: 0.1, position: 5 }); expect(result.queries).toHaveLength(1); expect(result.pages).toHaveLength(1);
  });
  it("handles empty data without non-finite values", () => { expect(summariseMetrics([]).totals).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 }); });
});
describe("routing event patterns", () => {
  it("accepts known event types, categories through exact types and wildcards", () => { expect(normalizeEventPatterns(["monitor.*", "task.assigned", "*"]).ok).toBe(true); });
  it("rejects unknown event types", () => { expect(normalizeEventPatterns(["secret.unknown"]).ok).toBe(false); });
});

describe("Search Console property boundaries", () => {
  it("rejects hostname prefix and credential tricks", async () => {
    const { belongsToProperty } = await import("@/lib/seo/audit");
    expect(belongsToProperty("https://example.org/", "https://example.org.evil.test/a")).toBe(false);
    expect(belongsToProperty("sc-domain:example.org", "https://example.org@evil.test/a")).toBe(false);
    expect(belongsToProperty("sc-domain:example.org", "https://sub.example.org/a")).toBe(true);
    expect(belongsToProperty("https://example.org/build/", "https://example.org/build/night")).toBe(true);
    expect(belongsToProperty("https://example.org/build/", "https://example.org/other/")).toBe(false);
  });
});
