import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Model-backed flows with a scripted Anthropic client: nothing here calls
 * the real API. Each `stream()` call shifts the next prepared reply.
 */
type Reply = { content: Array<Record<string, unknown>>; stop_reason: string } | Error;
const script = vi.hoisted(() => ({ replies: [] as Array<unknown>, calls: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/assistant/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant/client")>();
  return {
    ...actual,
    getAssistantConfig: async () => ({ apiKey: "test-key", model: "claude-opus-5-5", jobModel: "claude-haiku-5-5" }),
    createAnthropicClient: () => ({
      beta: {
        messages: {
          stream: (params: Record<string, unknown>) => {
            script.calls.push(structuredClone(params));
            const reply = script.replies.shift() as Reply | undefined;
            if (!reply) throw new Error("no scripted reply left");
            const message = reply instanceof Error ? null : { id: `msg_${script.calls.length}`, type: "message", role: "assistant", model: params.model, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 }, ...reply };
            return {
              async *[Symbol.asyncIterator]() {
                if (!message) throw reply;
                for (const block of message.content) {
                  if (block.type === "text") yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } };
                }
              },
              finalMessage: async () => {
                if (!message) throw reply;
                return message;
              },
            };
          },
        },
      },
    }),
  };
});

import { prisma } from "@/lib/db";
import { runChatTurn, type ChatStreamEvent } from "@/lib/assistant/chat";
import { runDueJobs } from "@/lib/assistant/jobs";
import { runBoardroomSession } from "@/lib/assistant/boardroom";
import { cleanup, uniqueSuffix } from "../helpers/fixtures";
import { buildWorld, type World } from "./assistant-fixtures";

const suffix = uniqueSuffix();
let w: World;

const text = (value: string) => ({ content: [{ type: "text", text: value }], stop_reason: "end_turn" });
const toolUse = (id: string, name: string, input: unknown, lead = "") => ({
  content: [...(lead ? [{ type: "text", text: lead }] : []), { type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});

async function chat(conversationId: string, body: { text?: string; decision?: "approve" | "decline" }) {
  const events: ChatStreamEvent[] = [];
  await runChatTurn({ principal: w.principal(w.users.member.id, "MEMBER"), conversationId, ...body, emit: (event) => events.push(event) });
  return events;
}

describe.sequential("assistant runs with a mocked model", () => {
  beforeAll(async () => {
    w = await buildWorld(suffix);
  });

  beforeEach(() => {
    script.replies = [];
    script.calls = [];
  });

  afterAll(async () => {
    await cleanup(w.slugs, w.domain);
    await prisma.$disconnect();
  });

  it("runs reads directly, pauses writes for confirmation, then creates the task", async () => {
    const conversation = await prisma.assistantConversation.create({ data: { workspaceId: w.a.id, userId: w.users.member.id } });
    script.replies.push(
      toolUse("tu_1", "sw_list_tasks", { project: "BOT" }),
      toolUse("tu_2", "sw_create_task", { title: "Order PLA filament", project: "BOT" }, "I'll add that task."),
    );
    const first = await chat(conversation.id, { text: "Add a task to order filament" });
    expect(first.find((e) => e.type === "tool" && e.tool.status === "done")).toMatchObject({ tool: { name: "sw_list_tasks", summary: "Looked up 1 task" } });
    expect(first.find((e) => e.type === "confirm")).toMatchObject({ calls: [{ name: "sw_create_task", input: { title: "Order PLA filament", project: "BOT" } }] });
    expect(first.find((e) => e.type === "title")).toMatchObject({ title: "Add a task to order filament" });
    expect(await prisma.task.count({ where: { title: "Order PLA filament" } })).toBe(0);

    // Request shape: cached stable system block, deterministic tools with eager streaming, fallbacks on Opus.
    const params = script.calls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config).toEqual({ effort: "medium" });
    expect((params.system as Array<{ cache_control?: unknown }>)[0]!.cache_control).toEqual({ type: "ephemeral" });
    const tools = params.tools as Array<{ name: string; eager_input_streaming?: boolean }>;
    expect(tools.every((t) => t.eager_input_streaming === true)).toBe(true);
    expect(tools.map((t) => t.name)).toContain("sw_create_task");
    expect(tools.map((t) => t.name)).not.toContain("sw_finance_summary");

    script.replies.push(text("Done: **BOT-3** is on the board."));
    const second = await chat(conversation.id, { decision: "approve" });
    expect(second.find((e) => e.type === "tool" && e.tool.status !== "running")).toMatchObject({ tool: { name: "sw_create_task", status: "done" } });
    expect(second.at(-1)).toMatchObject({ type: "done", stop: "done" });
    const task = await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, title: "Order PLA filament" } });
    expect(task.creatorId).toBe(w.users.member.id);
    // The confirmed tool result went back to the model in the same order.
    const lastMessages = script.calls[0 + 2]!.messages as Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }>;
    expect(lastMessages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_2" }] });
    expect(JSON.stringify(lastMessages)).not.toContain("_sw");

    const rows = await prisma.assistantMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.role)).toEqual(["USER", "ASSISTANT", "TOOL", "ASSISTANT", "TOOL", "ASSISTANT"]);
    expect(rows.filter((r) => r.role === "ASSISTANT").every((r) => r.tokensIn === 150 && r.tokensOut === 20)).toBe(true);
  });

  it("records a declined change without running it", async () => {
    const conversation = await prisma.assistantConversation.create({ data: { workspaceId: w.a.id, userId: w.users.member.id } });
    script.replies.push(toolUse("tu_9", "sw_send_channel_message", { channel: "general", text: "Pizza!" }));
    await chat(conversation.id, { text: "Tell everyone about pizza" });
    script.replies.push(text("No problem, I didn't post it."));
    const events = await chat(conversation.id, { decision: "decline" });
    expect(events.find((e) => e.type === "tool")).toMatchObject({ tool: { status: "error", summary: "Declined" } });
    expect(await prisma.message.count({ where: { body: "Pizza!" } })).toBe(0);
    const sent = script.calls.at(-1)!.messages as Array<{ content: Array<{ is_error?: boolean; content?: string }> }>;
    expect(sent.at(-1)!.content[0]).toMatchObject({ is_error: true });
  });

  it("refuses conversations that belong to someone else", async () => {
    const conversation = await prisma.assistantConversation.create({ data: { workspaceId: w.a.id, userId: w.users.owner.id } });
    const events = await chat(conversation.id, { text: "hi" });
    expect(events).toEqual([{ type: "error", message: "That conversation isn't available." }]);
    expect(script.calls).toHaveLength(0);
  });

  it("runs a due scheduled job once with the cheap model and read-only tools, posts it and dispatches", async () => {
    const now = new Date("2026-10-19T02:30:00Z");
    const job = await prisma.scheduledJob.create({
      data: { workspaceId: w.a.id, name: "Morning digest", cron: "0 8 * * *", timezone: "Asia/Kolkata", prompt: "Write the morning digest.", channelId: w.channels.general.id, createdById: w.users.owner.id, nextRunAt: new Date(now.getTime() - 60_000) },
    });
    script.replies.push(toolUse("tu_j1", "sw_list_tasks", { dueWithinDays: 1 }), text("**Today**\n- BOT-1 is due"));
    expect(await runDueJobs(now)).toBe(1);

    const params = script.calls[0]!;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.fallbacks).toBeUndefined();
    expect((params.tools as Array<{ name: string }>).some((t) => ["sw_create_task", "sw_send_channel_message", "sw_remember", "sw_forget"].includes(t.name))).toBe(false);

    const posted = await prisma.message.findFirstOrThrow({ where: { channelId: w.channels.general.id, authorKind: "ASSISTANT" } });
    expect(posted.body).toContain("BOT-1 is due");
    const saved = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.lastStatus).toBe("ok");
    expect(saved.nextRunAt!.toISOString()).toBe("2026-10-20T02:30:00.000Z");
    const conversation = await prisma.assistantConversation.findFirstOrThrow({ where: { userId: w.users.owner.id, title: "Scheduled: Morning digest" }, include: { messages: true } });
    expect(conversation.messages).toHaveLength(2);
    const events = await prisma.notificationEventRecord.findMany({ where: { workspaceId: w.a.id, type: { in: ["digest.ready", "assistant.job.completed"] } } });
    expect(events.map((e) => e.type).sort()).toEqual(["assistant.job.completed", "digest.ready"]);
    expect(await prisma.notification.count({ where: { userId: w.users.owner.id, kind: "assistant.job.completed" } })).toBe(1);

    // Claimed: the same tick again does nothing.
    expect(await runDueJobs(now)).toBe(0);
    expect(script.calls).toHaveLength(2);
  });

  it("pauses a job whose creator left", async () => {
    const now = new Date("2026-10-19T03:00:00Z");
    const job = await prisma.scheduledJob.create({
      data: { workspaceId: w.a.id, name: "Guest job", cron: "*/5 * * * *", timezone: "UTC", prompt: "Summarise the day.", createdById: w.users.guest.id, nextRunAt: new Date(now.getTime() - 1000) },
    });
    await runDueJobs(now);
    const saved = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved.enabled).toBe(false);
    expect(saved.lastStatus).toMatch(/^skipped/);
    expect(script.calls).toHaveLength(0);
  });

  it("runs a Boardroom session seat by seat, then the moderator", async () => {
    const session = await prisma.boardroomSession.create({
      data: {
        workspaceId: w.a.id,
        title: "Laser",
        question: "Should we buy a second laser cutter?",
        rounds: 2,
        createdById: w.users.member.id,
        seats: { create: [{ name: "Treasurer", persona: "Money first.", position: 0 }, { name: "Maker", persona: "Build first.", position: 1 }] },
      },
    });
    script.replies.push(text("Too costly."), text("We need it."), text("Still costly."), text("Lease one."), text("## Recommendation\nLease first.\n## Dissent\nTreasurer."));
    expect(await runBoardroomSession(session.id)).toBe("done");
    const saved = await prisma.boardroomSession.findUniqueOrThrow({ where: { id: session.id }, include: { turns: { orderBy: [{ round: "asc" }, { createdAt: "asc" }] } } });
    expect(saved.status).toBe("DONE");
    expect(saved.summary).toContain("Lease first.");
    expect(saved.turns.map((t) => `${t.role}:${t.round}:${t.content}`)).toEqual(["SEAT:1:Too costly.", "SEAT:1:We need it.", "SEAT:2:Still costly.", "SEAT:2:Lease one.", expect.stringContaining("MODERATOR:2:")]);
    // The fourth seat turn saw the whole transcript before it.
    const fourth = script.calls[3]!.messages as Array<{ content: string }>;
    expect(fourth[0]!.content).toContain("[Round 2] Treasurer:\nStill costly.");
    expect(await runBoardroomSession(session.id)).toBe("skipped");
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: w.a.id, type: "boardroom.summary_ready" } })).toBe(1);
  });

  it("marks a Boardroom session failed when the model errors", async () => {
    const session = await prisma.boardroomSession.create({
      data: { workspaceId: w.a.id, title: "Oops", question: "Will this fail?", rounds: 1, seats: { create: [{ name: "A", persona: "a" }, { name: "B", persona: "b" }] } },
    });
    script.replies.push(new Error("boom"));
    expect(await runBoardroomSession(session.id)).toBe("failed");
    expect((await prisma.boardroomSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("FAILED");
  });
});
