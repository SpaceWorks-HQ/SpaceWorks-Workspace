import { describe, expect, it } from "vitest";
import { burnUp, carryOverTaskIds } from "@/lib/cycles/progress";
import { resultProgress, goalRollup } from "@/lib/goals/progress";
import { tallyPoll, resultsVisible } from "@/lib/polls/tally";
import { mergedVoterIds } from "@/lib/ideas/merge";
import { applyTemplate } from "@/lib/templates/application";
import { contentHash, ipHash } from "@/lib/signatures/service";

const at = new Date("2026-10-01T00:00:00Z");
describe("work collaboration: cycle progress", () => {
  it("carries only unfinished, live work", () => {
    expect(
      carryOverTaskIds([
        { id: "open", completedAt: null, createdAt: at },
        { id: "done", completedAt: at, createdAt: at },
        { id: "archived", completedAt: null, archivedAt: at, createdAt: at },
      ]),
    ).toEqual(["open"]);
  });
  it("includes scope changes and completion in the accessible chart data", () => {
    const points = burnUp(
      [
        { id: "a", createdAt: at, completedAt: new Date("2026-10-02") },
        { id: "b", createdAt: new Date("2026-10-03"), completedAt: null },
      ],
      at,
      new Date("2026-10-04"),
      new Date("2026-10-04"),
    );
    expect(points[0]).toMatchObject({ scope: 1, completed: 0 });
    expect(points.at(-1)).toMatchObject({ scope: 2, completed: 1 });
  });
  it("bounds chart data for long cycles", () => {
    expect(
      burnUp([], at, new Date("2027-10-01"), new Date("2027-10-01")),
    ).toHaveLength(61);
  });
});
describe("work collaboration: OKR roll-up", () => {
  it.each([
    [0, 10, 5, 50],
    [100, 0, 75, 25],
    [0, 10, 20, 100],
    [0, 10, -1, 0],
    [5, 5, 5, 100],
  ])("normalises %s to %s at %s", (start, target, current, expected) => {
    expect(
      resultProgress({ metricType: "NUMBER", start, target, current }),
    ).toBe(expected);
  });
  it("supports percent and boolean metrics", () => {
    expect(
      resultProgress({
        metricType: "PERCENT",
        start: 0,
        target: 80,
        current: 40,
      }),
    ).toBe(50);
    expect(
      resultProgress({
        metricType: "BOOLEAN",
        start: 0,
        target: 1,
        current: 1,
      }),
    ).toBe(100);
  });
  it("weights each direct result and child objective equally", () => {
    expect(
      goalRollup(
        [{ metricType: "NUMBER", start: 0, target: 10, current: 5 }],
        [100, 0],
      ),
    ).toBe(50);
    expect(goalRollup([])).toBe(0);
  });
});
describe("work collaboration: poll tallying", () => {
  it("counts multi-choice ballots once per option", () => {
    const tally = tallyPoll(
      "MULTI",
      ["a", "b"],
      [{ choice: ["a", "a", "b"] }, { choice: ["b"] }],
    );
    expect(tally.counts).toEqual({ a: 1, b: 2 });
    expect(tally.ballots).toBe(2);
  });
  it("transfers ranked ballots after eliminating the lowest option", () => {
    const t = tallyPoll(
      "RANKED",
      ["a", "b", "c"],
      [
        { choice: ["a", "b"] },
        { choice: ["a", "b"] },
        { choice: ["b"] },
        { choice: ["c", "b"] },
        { choice: ["c", "b"] },
      ],
    );
    expect(t.rounds).toEqual([
      { a: 2, b: 1, c: 2 },
      { a: 2, c: 2 },
    ]);
    expect(t.winners).toEqual(["a", "c"]);
  });
  it("finds a transferred majority", () => {
    const t = tallyPoll(
      "RANKED",
      ["a", "b", "c"],
      [
        { choice: ["a"] },
        { choice: ["a"] },
        { choice: ["b"] },
        { choice: ["b"] },
        { choice: ["c", "b"] },
      ],
    );
    expect(t.winners).toEqual(["b"]);
    expect(t.rounds).toHaveLength(2);
  });
  it("preserves final ties and handles empty ballots", () => {
    expect(
      tallyPoll("RANKED", ["a", "b"], [{ choice: ["a"] }, { choice: ["b"] }])
        .winners,
    ).toEqual(["a", "b"]);
    expect(tallyPoll("RANKED", ["a", "b"], []).winners).toEqual([]);
  });
  it("uses deterministic displayed order for lowest-place ties", () => {
    const t = tallyPoll(
      "RANKED",
      ["a", "b", "c"],
      [
        { choice: ["a", "c"] },
        { choice: ["b", "c"] },
        { choice: ["c"] },
        { choice: ["c"] },
      ],
    );
    expect(t.winners).toEqual(["c"]);
  });
  it("supports count and percent quorum", () => {
    expect(
      tallyPoll("SINGLE", ["a"], [{ choice: ["a"] }], { percent: 60 }, 3)
        .quorumMet,
    ).toBe(false);
    expect(
      tallyPoll("SINGLE", ["a"], [{ choice: ["a"] }], { count: 1 }, 3)
        .quorumMet,
    ).toBe(true);
  });
  it("never carries voter metadata into aggregates", () => {
    const t = tallyPoll(
      "SINGLE",
      ["a"],
      [{ choice: ["a"], voterId: "secret-person" } as { choice: unknown }],
    );
    expect(JSON.stringify(t)).not.toContain("secret-person");
  });
  it("keeps delayed results hidden until closing", () => {
    expect(
      resultsVisible("AFTER_CLOSE", null, new Date("2026-11-01"), at),
    ).toBe(false);
    expect(resultsVisible("AFTER_CLOSE", null, at, at)).toBe(true);
    expect(resultsVisible("LIVE", null, null, at)).toBe(true);
  });
});
describe("work collaboration: ideas, templates and fingerprints", () => {
  it("merges overlapping votes without inflation", () => {
    expect(mergedVoterIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("applies template variables to plain text and sanitised HTML", () => {
    const result = applyTemplate(
      {
        title: "Build {{date}}",
        text: "{{author}} at {{workspace}}",
        html: "<script>alert(1)</script><p>{{author}}</p>",
      },
      { date: "19 Oct", author: "<Maker>", workspace: "Space Works" },
    );
    expect(result.title).toBe("Build 19 Oct");
    expect(result.text).toBe("<Maker> at Space Works");
    expect(result.html).toBe("<p>&lt;Maker&gt;</p>");
  });
  it("rejects malformed template content", () => {
    expect(() =>
      applyTemplate({ title: "" }, { date: "", author: "", workspace: "" }),
    ).toThrow();
  });
  it("binds a signature to both document title and content", () => {
    expect(contentHash("A", "<p>Text</p>")).not.toBe(
      contentHash("B", "<p>Text</p>"),
    );
    expect(contentHash("A", "one")).not.toBe(contentHash("A", "two"));
  });
  it("stores an IP fingerprint with a workspace boundary", () => {
    expect(ipHash("one", "127.0.0.1")).toHaveLength(64);
    expect(ipHash("one", "127.0.0.1")).not.toBe(ipHash("two", "127.0.0.1"));
  });
});
