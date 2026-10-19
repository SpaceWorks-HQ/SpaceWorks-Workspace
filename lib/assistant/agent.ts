import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { modelOptions, streamTurn } from "@/lib/assistant/client";
import type { Principal, ToolChannel } from "@/lib/assistant/principal";
import { executeTool, isWriteTool, toolJsonSchema, type ExecuteOutcome } from "@/lib/assistant/tools";
import type { ToolDefinition } from "@/lib/assistant/tools/types";

/**
 * The tool-use loop shared by the web chat and scheduled jobs: stream a
 * model turn, run the requested sw_* tools with the caller's rights, feed the
 * results back, repeat. In chat, a turn that asks for a write stops the loop
 * with `pending` so the person can confirm first.
 */

export const MAX_TOOL_RESULT_CHARS = 40_000;

/** Our tool_result blocks carry `_sw` (card summary) for the UI; strip it before sending. */
export type StoredToolResult = BetaToolResultBlockParam & { _sw?: { name: string; title: string; summary: string } };

export function anthropicTools(tools: readonly ToolDefinition[]): BetaTool[] {
  return tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toolJsonSchema(tool),
    // Streamed requests: let tool input stream as generated; executeTool validates every input with Zod.
    eager_input_streaming: true,
    // Cache breakpoint after the (fixed-order) tool list.
    ...(index === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

export function systemBlocks(stable: string, context: string): BetaTextBlockParam[] {
  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: context },
  ];
}

/** Remove our private `_sw` keys so the API only sees standard blocks. */
export function toApiContent(blocks: readonly unknown[]): BetaContentBlockParam[] {
  return blocks.map((block) => {
    if (block && typeof block === "object" && "_sw" in block) {
      const { _sw: _ignored, ...rest } = block as StoredToolResult;
      void _ignored;
      return rest as BetaContentBlockParam;
    }
    return block as BetaContentBlockParam;
  });
}

export function toolUses(message: Pick<BetaMessage, "content">): BetaToolUseBlock[] {
  return message.content.filter((block): block is BetaToolUseBlock => block.type === "tool_use");
}

export type ToolEvent = { id: string; name: string; title: string; status: "running" | "done" | "error"; summary?: string };

/** Run tool calls (in parallel) and build one tool_result block per call, in order. */
export async function runToolCalls(
  principal: Principal,
  calls: readonly Pick<BetaToolUseBlock, "id" | "name" | "input">[],
  options: { via: ToolChannel; onTool?: (event: ToolEvent) => void; allowWrites: boolean },
): Promise<StoredToolResult[]> {
  return Promise.all(
    calls.map(async (call) => {
      options.onTool?.({ id: call.id, name: call.name, title: call.name, status: "running" });
      const outcome =
        !options.allowWrites && isWriteTool(call.name)
          ? ({ ok: false, tool: undefined, error: "Changes are not allowed here.", code: "forbidden" } as ExecuteOutcome)
          : await executeTool(principal, call.name, call.input, { via: options.via });
      const title = outcome.tool?.title ?? call.name;
      if (outcome.ok) {
        const text = JSON.stringify(outcome.result.data);
        options.onTool?.({ id: call.id, name: call.name, title, status: "done", summary: outcome.result.summary });
        return {
          type: "tool_result",
          tool_use_id: call.id,
          content: text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (cut)` : text,
          _sw: { name: call.name, title, summary: outcome.result.summary },
        } satisfies StoredToolResult;
      }
      options.onTool?.({ id: call.id, name: call.name, title, status: "error", summary: outcome.error });
      return { type: "tool_result", tool_use_id: call.id, is_error: true, content: outcome.error, _sw: { name: call.name, title, summary: outcome.error } } satisfies StoredToolResult;
    }),
  );
}

export type LoopStop = "done" | "confirm" | "refusal" | "truncated" | "max_rounds";

export type LoopInput = {
  client: Anthropic;
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  system: BetaTextBlockParam[];
  tools: readonly ToolDefinition[];
  /** History so far (API shape). The loop appends to a copy. */
  messages: BetaMessageParam[];
  principal: Principal;
  via: ToolChannel;
  /** Stop before running writes and hand them back for confirmation (chat). Jobs pass false and get no write tools. */
  confirmWrites: boolean;
  maxRounds?: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onTool?: (event: ToolEvent) => void;
  /** Persist each assistant message as it completes. */
  onAssistant?: (message: BetaMessage) => Promise<void>;
  /** Persist each tool-results user turn. */
  onToolResults?: (results: StoredToolResult[]) => Promise<void>;
};

export async function runAgentLoop(input: LoopInput): Promise<{ stop: LoopStop; last: BetaMessage | null; pending: BetaToolUseBlock[] }> {
  const messages = [...input.messages];
  const tools = anthropicTools(input.tools);
  const writeNames = new Set<string>(input.tools.filter((tool) => tool.write).map((tool) => tool.name));
  let last: BetaMessage | null = null;
  for (let round = 0; round < (input.maxRounds ?? 8); round++) {
    const message = await streamTurn(
      input.client,
      {
        model: input.model,
        max_tokens: input.maxTokens,
        system: input.system,
        tools,
        messages,
        output_config: { effort: input.effort },
        cache_control: { type: "ephemeral" },
        ...modelOptions(input.model),
      },
      { signal: input.signal, onText: input.onText },
    );
    last = message;
    if (message.content.length > 0) {
      await input.onAssistant?.(message);
      messages.push({ role: "assistant", content: message.content as BetaContentBlockParam[] });
    }
    if (message.stop_reason === "refusal") return { stop: "refusal", last, pending: [] };
    if (message.stop_reason === "pause_turn") continue;
    const calls = toolUses(message);
    if (calls.length === 0) return { stop: "done", last, pending: [] };
    // A tool input cut off at max_tokens can still look valid: never run it.
    if (message.stop_reason === "max_tokens") return { stop: "truncated", last, pending: calls };
    if (input.confirmWrites && calls.some((call) => writeNames.has(call.name))) return { stop: "confirm", last, pending: calls };
    const results = await runToolCalls(input.principal, calls, { via: input.via, onTool: input.onTool, allowWrites: false });
    await input.onToolResults?.(results);
    messages.push({ role: "user", content: toApiContent(results) as BetaContentBlockParam[] });
  }
  return { stop: "max_rounds", last, pending: [] };
}
