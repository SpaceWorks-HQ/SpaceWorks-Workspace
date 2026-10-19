import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getAssistantSettings } from "@/lib/instanceSettings";

/**
 * Anthropic access for the Space Works Assistant. The API key and default
 * model come from instance settings (super-admin, encrypted) with the
 * ANTHROPIC_API_KEY / ASSISTANT_MODEL environment fallback. Scheduled jobs
 * use a cheaper model (ASSISTANT_JOB_MODEL, default Claude Haiku 5.5).
 *
 * Tests mock this module; nothing else in the app constructs a client.
 */

export const DEFAULT_JOB_MODEL = "claude-haiku-5-5";

export type AssistantConfig = { apiKey: string; model: string; jobModel: string };

/** Null when no API key is configured (the UI shows the "not configured" state). */
export async function getAssistantConfig(): Promise<AssistantConfig | null> {
  const settings = await getAssistantSettings();
  if (!settings.apiKey) return null;
  return { apiKey: settings.apiKey, model: settings.model, jobModel: process.env.ASSISTANT_JOB_MODEL?.trim() || DEFAULT_JOB_MODEL };
}

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60_000 });
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

/** Request fields that depend on the model: refusal fallback where supported. */
export function modelOptions(model: string): Pick<MessageCreateParamsBase, "betas" | "fallbacks"> {
  return FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

export type StreamParams = Omit<MessageCreateParamsBase, "stream">;

/**
 * One streamed model turn. Text deltas go to `onText`; the complete message
 * (thinking, text and tool_use blocks, stop reason, usage) is returned.
 * Aborting `signal` rejects with Anthropic.APIUserAbortError.
 */
export async function streamTurn(
  client: Anthropic,
  params: StreamParams,
  options: { signal?: AbortSignal; onText?: (delta: string) => void } = {},
): Promise<BetaMessage> {
  const stream = client.beta.messages.stream(params, options.signal ? { signal: options.signal } : undefined);
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") options.onText?.(event.delta.text);
  }
  return stream.finalMessage();
}

export function usageTotals(message: Pick<BetaMessage, "usage">) {
  const usage = message.usage;
  return {
    tokensIn: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    tokensOut: usage.output_tokens ?? 0,
  };
}

export function messageText(message: Pick<BetaMessage, "content">): string {
  return message.content
    .filter((block): block is Extract<BetaMessage["content"][number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
