import { beforeEach, describe, expect, it, vi } from "vitest";

const membership = {
  role: "MEMBER",
  user: { name: "Meera" },
  workspace: { id: "ws1", slug: "tinkerspace-kochi", name: "TinkerSpace Kochi", timezone: "Asia/Kolkata", currency: "INR", financeVisibleToMembers: false },
};
const db = {
  membership: { findFirst: vi.fn() },
  assistantConversation: { create: vi.fn() },
};
const runChatTurn = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/assistant/chat", () => ({ runChatTurn: (...args: unknown[]) => runChatTurn(...args) }));

const { runMessagingTurn } = await import("@/lib/assistant/messaging");

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.findFirst.mockResolvedValue(membership);
  db.assistantConversation.create.mockResolvedValue({ id: "conv1" });
});

describe("runMessagingTurn", () => {
  it("runs as the linked member in a new conversation and returns the streamed text", async () => {
    runChatTurn.mockImplementation(async ({ emit }) => {
      emit({ type: "text", text: "Two tasks are due " });
      emit({ type: "text", text: "today." });
    });
    const result = await runMessagingTurn({ workspaceId: "ws1", userId: "u1", text: "What is due?" });
    expect(result).toEqual({ text: "Two tasks are due today.", conversationId: "conv1" });
    const call = runChatTurn.mock.calls[0][0];
    expect(call.principal).toMatchObject({ kind: "user", userId: "u1", role: "MEMBER", workspace: { id: "ws1" } });
    expect(call.conversationId).toBe("conv1");
  });

  it("reuses an existing conversation and asks for confirmation in the web app", async () => {
    runChatTurn.mockImplementation(async ({ emit }) => emit({ type: "confirm", calls: [] }));
    const result = await runMessagingTurn({ workspaceId: "ws1", userId: "u1", text: "Create a task", conversationId: "conv9" });
    expect(db.assistantConversation.create).not.toHaveBeenCalled();
    expect(result.conversationId).toBe("conv9");
    expect(result.text).toContain("/w/tinkerspace-kochi/assistant/c/conv9");
  });

  it("refuses when the person is no longer an active member", async () => {
    db.membership.findFirst.mockResolvedValue(null);
    await expect(runMessagingTurn({ workspaceId: "ws1", userId: "u1", text: "hi" })).rejects.toThrow("access has changed");
    expect(runChatTurn).not.toHaveBeenCalled();
  });
});
