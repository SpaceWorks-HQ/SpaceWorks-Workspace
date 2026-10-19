import "server-only";
import type { DestinationAdapter } from "./types";
import { parseDestinationConfig } from "@/lib/integrations/destinationConfig";
import { failToSendResult } from "@/lib/integrations/http";
import { sendTelegramMessage } from "@/lib/messaging/api/telegram";
import { escapeTelegramHtml } from "@/lib/messaging/format/escape";
import { truncateEscaped } from "@/lib/messaging/format/message";
import { botTarget, invalidTarget } from "@/lib/messaging/targets";
export const telegramAdapter: DestinationAdapter = {
  kind: "TELEGRAM", personalChannel: "TELEGRAM_DM", label: "Telegram", configured: true,
  async send(input) {
    const bot = botTarget(input, "TELEGRAM");
    if (!bot) return invalidTarget;
    const config = input.target.type === "destination" ? parseDestinationConfig("TELEGRAM", input.target.destination.config) : null;
    const chat = bot.identity?.dmChannelId ?? config?.chatId;
    if (!chat) return invalidTarget;
    const text = truncateEscaped(escapeTelegramHtml(`${input.isTest ? "[Test] " : ""}${input.message.severityLabel}: ${input.message.title}\n${input.message.text}\n${input.message.url ?? ""}`), 4096);
    const result = await sendTelegramMessage(bot.credentials.botToken, { chat_id: chat, text, parse_mode: "HTML", ...(config?.messageThreadId ? { message_thread_id: config.messageThreadId } : {}), ...(input.thread?.providerMessageId ? { reply_parameters: { message_id: Number(input.thread.providerMessageId), allow_sending_without_reply: true } } : {}) });
    return result.ok ? { ok: true, providerMessageId: String(result.data.message_id) } : failToSendResult(result);
  },
};
