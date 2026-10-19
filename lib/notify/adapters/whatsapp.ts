import "server-only";
import type { DestinationAdapter } from "./types";
import { prisma } from "@/lib/db";
import { parseDestinationConfig } from "@/lib/integrations/destinationConfig";
import { failToSendResult } from "@/lib/integrations/http";
import { sendWhatsAppText, sendWhatsAppTemplate, whatsappErrorCode, WHATSAPP_WINDOW_CLOSED_CODES, waNumber } from "@/lib/messaging/api/whatsapp";
import { truncate } from "@/lib/messaging/format/escape";
import { botTarget, invalidTarget } from "@/lib/messaging/targets";
export const whatsappAdapter: DestinationAdapter = {
  kind: "WHATSAPP", personalChannel: "WHATSAPP_DM", label: "WhatsApp", configured: true,
  async send(input) {
    const bot = botTarget(input, "WHATSAPP");
    if (!bot?.config.phoneNumberId) return invalidTarget;
    const config = input.target.type === "destination" ? parseDestinationConfig("WHATSAPP", input.target.destination.config) : null;
    const to = bot.identity?.externalUserId ?? config?.to;
    if (!to || (bot.identity && !bot.identity.optInAt)) return invalidTarget;
    const text = truncate(`${input.isTest ? "[Test] " : ""}${input.message.severityLabel}: ${input.message.title}\n${input.message.text}\n${input.message.url ?? ""}`, 4096);
    const recent = await prisma.inboundEvent.findFirst({ where: { connectionId: bot.connection.id, connection: { workspaceId: input.message.workspace.id }, kind: `whatsapp:${waNumber(to)}`, receivedAt: { gt: new Date(Date.now() - 86400000) } }, select: { id: true } });
    const template = () => {
      const name = config?.templateName ?? bot.config.templateName;
      if (!name) return null;
      return sendWhatsAppTemplate(bot.credentials.accessToken, bot.config.phoneNumberId!, to, { name, language: config?.templateLanguage ?? bot.config.templateLanguage ?? "en", bodyParams: [truncate(text, 1024)] }, { version: bot.config.graphVersion });
    };
    let result = recent ? await sendWhatsAppText(bot.credentials.accessToken, bot.config.phoneNumberId, to, text, { version: bot.config.graphVersion }) : await template();
    if (result && WHATSAPP_WINDOW_CLOSED_CODES.has(whatsappErrorCode(result) ?? -1)) result = await template();
    if (!result) return { ok: false, retryable: false, error: "Outside the WhatsApp service window. Configure an approved notification template." };
    return result.ok ? { ok: true, providerMessageId: result.data.messages[0]?.id } : failToSendResult(result);
  },
};
