import { describe, expect, it } from "vitest";
import { escapeSlackText, normaliseSlackText, verifySlackSignature } from "@/lib/appReviews/slackSecurity";
import { canManageAppReviews, canViewAppReviews } from "@/lib/roles";
import { parseRuleFilters, ruleMatchesEvent, type MatchableRule } from "@/lib/notify/match";

const raw = '{"type":"url_verification","challenge":"test"}';
const timestamp = "1792315800";
const signature = "v0=eba63f32f087596cc568ea488e37f8509c7610b57333425013de22de305ef152";
const now = new Date(Number(timestamp) * 1000);
describe("app review Slack security", () => {
  it("escapes untrusted review text so fallback messages cannot create Slack mentions", () => {
    expect(escapeSlackText("<@U123> <!channel> & feedback")).toBe("&lt;@U123&gt; &lt;!channel&gt; &amp; feedback");
  });
  it("verifies a fixed v0 signature vector over the exact body", () => {
    expect(verifySlackSignature("app-reviews-test-signing-secret", raw, timestamp, signature, now)).toBe(true);
    expect(verifySlackSignature("app-reviews-test-signing-secret", `${raw}\n`, timestamp, signature, now)).toBe(false);
    expect(verifySlackSignature("wrong", raw, timestamp, signature, now)).toBe(false);
  });
  it.each([300001, -300001])("rejects signatures outside the five-minute window (%s ms)", offset => {
    expect(verifySlackSignature("app-reviews-test-signing-secret", raw, timestamp, signature, new Date(now.getTime() + offset + (offset > 0 ? 1000 : -1000)))).toBe(false);
  });
  it.each([null, "", "v0=abc", "v1=" + "0".repeat(64), "v0=" + "g".repeat(64)])("rejects malformed signatures safely: %s", value => expect(verifySlackSignature("secret", raw, timestamp, value, now)).toBe(false));
  it("removes Slack mentions and formatting while preserving link labels and readable text", () => {
    expect(normaliseSlackText("<!channel> Hi <@U1|Meera>, *thanks* for <https://example.test/help|the report>. &amp; `_fixed_`"))
      .toBe("Hi Meera, thanks for the report (https://example.test/help). & fixed");
    expect(normaliseSlackText("<@U1> in <#C1|support>\r\n```text\nhello\n```"))
      .toBe("a teammate in #support\nhello");
    expect(normaliseSlackText("Contact <mailto:help@example.test|support> and <!subteam^S1|@support> in <#C1>."))
      .toBe("Contact support (help@example.test) and the team in a channel.");
  });
});
describe("app review role capabilities", () => {
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)("gates %s", role => {
    expect(canViewAppReviews({ role })).toBe(role !== "GUEST");
    expect(canManageAppReviews({ role })).toBe(role === "OWNER" || role === "ADMIN");
  });
});
describe("rating-based notification rules", () => {
  const rule: MatchableRule = { id: "rule", enabled: true, scopeType: "REVIEWED_APP", scopeId: "app", eventTypes: ["app_review.*"], minSeverity: "INFO", filters: { ratings: [1, 2] }, quietHours: null, criticalBypassesQuiet: true, dedupeWindowSec: 300 };
  it.each([1, 2, 3, 4, 5])("filters rating %s", rating => {
    expect(ruleMatchesEvent(rule, { type: "app_review.received", severity: "info", scope: { reviewedAppId: "app", rating } })).toBe(rating <= 2);
  });
  it("requires the correct app and a rating on filtered events", () => {
    expect(ruleMatchesEvent(rule, { type: "app_review.received", severity: "info", scope: { reviewedAppId: "other", rating: 1 } })).toBe(false);
    expect(ruleMatchesEvent(rule, { type: "app_review.received", severity: "info", scope: { reviewedAppId: "app" } })).toBe(false);
    expect(parseRuleFilters({ ratings: [0, "1", 1, 2.5, 5, 6] }).ratings).toEqual([1, 5]);
  });
});
