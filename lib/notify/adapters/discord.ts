import "server-only";
import type { DestinationAdapter } from "./types";
import { parseDestinationConfig, webhookUrlProblem } from "@/lib/integrations/destinationConfig";
import { openDestinationSecrets } from "@/lib/integrations/destinationSecrets";
import { failToSendResult } from "@/lib/integrations/http";
import { createDiscordMessage, executeDiscordWebhook, openDiscordDm } from "@/lib/messaging/api/discord";
import { formatDiscordMessage } from "@/lib/messaging/format/discord";
import { botTarget, invalidTarget } from "@/lib/messaging/targets";
export const discordAdapter: DestinationAdapter = {
  kind: "DISCORD", personalChannel: "DISCORD_DM", label: "Discord", configured: true,
  async send(input) {
    const payload = formatDiscordMessage(input.message, { isTest: input.isTest });
    const config = input.target.type === "destination" ? parseDestinationConfig("DISCORD", input.target.destination.config) : null;
    if (config?.mode === "webhook" && input.target.type === "destination") {
      const url = openDestinationSecrets(input.target.destination.secretEnc).webhookUrl;
      if (!url || webhookUrlProblem("DISCORD", url)) return invalidTarget;
      const result = await executeDiscordWebhook(url, payload, { threadId: config.threadId });
      return result.ok ? { ok: true, providerMessageId: result.data.id } : failToSendResult(result);
    }
    const bot = botTarget(input, "DISCORD");
    if (!bot) return invalidTarget;
    let channel = bot.identity?.dmChannelId ?? (config?.mode === "bot" ? config.channelId : null);
    if (!channel && bot.identity) {
      const dm = await openDiscordDm(bot.credentials.botToken, bot.identity.externalUserId);
      if (!dm.ok) return failToSendResult(dm);
      channel = dm.data.id;
    }
    if (!channel) return invalidTarget;
    const result = await createDiscordMessage(bot.credentials.botToken, channel, payload);
    return result.ok ? { ok: true, providerMessageId: result.data.id } : failToSendResult(result);
  },
};
