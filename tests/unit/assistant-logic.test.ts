import { describe, expect, it } from "vitest";
import { digestFrequency, nextRunAt, upcomingRuns, validateCron } from "@/lib/assistant/cron";
import { boardroomMarkdown, moderatorMessage, moderatorSystemPrompt, PERSONA_PRESETS, seatSystemPrompt, seatTurnMessage } from "@/lib/assistant/boardroomPrompts";
import { parseInline, parseMarkdown, safeHref } from "@/lib/assistant/markdown";
import { buildRequestContext, buildStableSystemPrompt, conversationTitle } from "@/lib/assistant/prompt";
import { pendingCalls, toApiMessages, toChatItems } from "@/lib/assistant/chat";

describe("cron schedules", () => {
  it("validates five-field expressions and time zones", () => {
    expect(validateCron("0 8 * * *", "Asia/Kolkata").ok).toBe(true);
    expect(validateCron("0 0 8 * * *", "Asia/Kolkata").ok).toBe(false);
    expect(validateCron("61 8 * * *", "Asia/Kolkata").ok).toBe(false);
    expect(validateCron("0 8 * * *", "Mars/Olympus").ok).toBe(false);
  });

  it("computes the next run in the job's time zone", () => {
    const after = new Date("2026-10-19T00:00:00Z");
    // 08:00 IST is 02:30 UTC.
    expect(nextRunAt("0 8 * * *", "Asia/Kolkata", after).toISOString()).toBe("2026-10-19T02:30:00.000Z");
    // 08:00 in London during BST (UTC+1) is 07:00 UTC; after the clocks change (25 Oct 2026) it is 08:00 UTC.
    expect(nextRunAt("0 8 * * *", "Europe/London", after).toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(nextRunAt("0 8 * * *", "Europe/London", new Date("2026-10-26T00:00:00Z")).toISOString()).toBe("2026-10-26T08:00:00.000Z");
    // Strictly after: a run exactly at `after` moves to the next day.
    expect(nextRunAt("30 2 * * *", "UTC", new Date("2026-10-19T02:30:00Z")).toISOString()).toBe("2026-10-20T02:30:00.000Z");
    expect(upcomingRuns("0 18 * * 5", "Asia/Kolkata", after, 2).map((d) => d.toISOString())).toEqual(["2026-10-23T12:30:00.000Z", "2026-10-30T12:30:00.000Z"]);
  });

  it("classifies digest cadence", () => {
    expect(digestFrequency("15 * * * *")).toBe("hourly");
    expect(digestFrequency("0 8 * * *")).toBe("daily");
    expect(digestFrequency("0 18 * * 5")).toBe("weekly");
    expect(digestFrequency("0 8 * * 1-5")).toBe("custom");
  });
});

describe("boardroom prompts", () => {
  const seats = PERSONA_PRESETS.slice(0, 3).map((p, i) => ({ id: `s${i}`, name: p.name, persona: p.persona }));

  it("gives each seat its persona and the other seats", () => {
    const prompt = seatSystemPrompt({ workspaceName: "Kochi", seat: seats[0]!, seats, rounds: 2 });
    expect(prompt).toContain(`"${seats[0]!.name}"`);
    expect(prompt).toContain(seats[0]!.persona);
    expect(prompt).toContain(`Other seats: ${seats[1]!.name}, ${seats[2]!.name}`);
    expect(prompt).toContain("2 rounds");
  });

  it("feeds the transcript so far into later turns", () => {
    const first = seatTurnMessage({ question: "Buy a laser?", round: 1, rounds: 2, transcript: [] });
    expect(first).toContain("You speak first");
    const transcript = [{ seatId: "s0", seatName: "Treasurer", round: 1, role: "SEAT" as const, content: "Too expensive." }];
    const later = seatTurnMessage({ question: "Buy a laser?", round: 2, rounds: 2, transcript });
    expect(later).toContain("[Round 1] Treasurer:\nToo expensive.");
    expect(later).toContain("final round");
    const moderator = moderatorMessage({ question: "Buy a laser?", seats, transcript });
    expect(moderator).toContain("Too expensive.");
    expect(moderatorSystemPrompt("Kochi")).toContain("## Dissent");
  });

  it("exports markdown with outcome and rounds", () => {
    const md = boardroomMarkdown({
      title: "Laser",
      question: "Buy a laser?",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      seats,
      summary: "## Recommendation\nWait.",
      transcript: [
        { seatId: "s0", seatName: "Treasurer", round: 1, role: "SEAT", content: "No." },
        { seatId: "s1", seatName: "Safety lead", round: 2, role: "SEAT", content: "Train first." },
        { seatId: null, seatName: "Moderator", round: 2, role: "MODERATOR", content: "ignored" },
      ],
    });
    expect(md).toContain("# Laser");
    expect(md).toContain("## Outcome");
    expect(md).toContain("### Round 1");
    expect(md).toContain("### Round 2");
    expect(md).not.toContain("ignored");
  });
});

describe("markdown rendering tree", () => {
  it("keeps raw HTML as text", () => {
    const blocks = parseMarkdown("<script>alert(1)</script> and <img src=x onerror=alert(1)>");
    expect(blocks).toEqual([{ type: "paragraph", children: [{ type: "text", text: "<script>alert(1)</script> and <img src=x onerror=alert(1)>" }] }]);
  });

  it("allows only safe link targets", () => {
    expect(safeHref("/w/kochi/projects/BOT")).toEqual({ href: "/w/kochi/projects/BOT", external: false });
    expect(safeHref("https://example.org/a")).toEqual({ href: "https://example.org/a", external: true });
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(parseInline("[click](javascript:alert%281%29)")).toEqual([{ type: "text", text: "click" }]);
  });

  it("parses headings, lists, code and inline marks", () => {
    const blocks = parseMarkdown("## Plan\n\n- **Buy** filament\n- see [BOT-1](/w/k/projects/BOT/tasks/1)\n\n1. one\n2. two\n\n```\ncode <b>\n```\n\nUse `npm` and _care_.");
    expect(blocks[0]).toEqual({ type: "heading", level: 3, children: [{ type: "text", text: "Plan" }] });
    expect(blocks[1]).toMatchObject({ type: "list", ordered: false, items: [[{ type: "strong" }, { type: "text", text: " filament" }], [{ type: "text" }, { type: "link", href: "/w/k/projects/BOT/tasks/1" }]] });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: true });
    expect(blocks[3]).toEqual({ type: "code", text: "code <b>" });
    expect(blocks[4]).toMatchObject({ type: "paragraph", children: [{ type: "text" }, { type: "code", text: "npm" }, { type: "text" }, { type: "em" }, { type: "text" }] });
  });
});

describe("assistant prompt and history", () => {
  it("puts skills in the stable prompt and the request facts in the volatile one", () => {
    const stable = buildStableSystemPrompt({ workspaceName: "Kochi", mode: "chat", skills: [{ name: "Weekly review", description: "Sum up the week.", body: "1. Look up tasks." }] });
    expect(stable).toContain("Space Works Assistant");
    expect(stable).toContain("## Weekly review");
    expect(stable).toContain("confirm");
    expect(stable).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(buildStableSystemPrompt({ workspaceName: "Kochi", mode: "job", skills: [] })).toContain("scheduled job");
    const context = buildRequestContext({ userName: "Meera", role: "MEMBER", now: new Date("2026-10-19T02:30:00Z"), timeZone: "Asia/Kolkata" });
    expect(context).toContain("Meera");
    expect(context).toContain("2026-10-19T02:30:00.000Z");
  });

  it("titles conversations from the first message", () => {
    expect(conversationTitle("  What's   due this week?  ")).toBe("What's due this week?");
    expect(conversationTitle("x".repeat(80))).toHaveLength(60);
  });

  it("strips UI metadata before replaying history and detects pending calls", () => {
    const rows = [
      { id: "1", role: "USER" as const, content: [{ type: "text", text: "Make a task" }] },
      { id: "2", role: "ASSISTANT" as const, content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "tu1", name: "sw_list_tasks", input: {} }] },
      { id: "3", role: "TOOL" as const, content: [{ type: "tool_result", tool_use_id: "tu1", content: "[]", _sw: { name: "sw_list_tasks", title: "Tasks", summary: "Looked up 0 tasks" } }] },
      { id: "4", role: "ASSISTANT" as const, content: [{ type: "text", text: "Creating it." }, { type: "tool_use", id: "tu2", name: "sw_create_task", input: { title: "X" } }] },
    ];
    const api = toApiMessages(rows);
    expect(api.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(JSON.stringify(api)).not.toContain("_sw");
    // Thinking blocks are replayed unchanged.
    expect(api[1]!.content).toEqual(rows[1]!.content);
    expect(pendingCalls(rows).map((c) => c.id)).toEqual(["tu2"]);
    expect(pendingCalls(rows.slice(0, 3))).toEqual([]);
    expect(toChatItems(rows).map((i) => i.kind)).toEqual(["user", "tool", "assistant"]);
  });
});
