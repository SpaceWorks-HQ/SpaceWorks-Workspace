import "server-only";
import type { DestinationAdapter } from "./types";
import { parseDestinationConfig, webhookUrlProblem } from "@/lib/integrations/destinationConfig";
import { openDestinationSecrets } from "@/lib/integrations/destinationSecrets";
import { failToSendResult } from "@/lib/integrations/http";
import { postSlackMessage, postSlackWebhook, openSlackDm } from "@/lib/messaging/api/slack";
import { formatSlackMessage } from "@/lib/messaging/format/slack";
import { threadRoot } from "@/lib/messaging/format/message";
import { botTarget, invalidTarget } from "@/lib/messaging/targets";
export const slackAdapter: DestinationAdapter = {
  kind: "SLACK", personalChannel: "SLACK_DM", label: "Slack", configured: true,
  async send(input) {
    const payload = formatSlackMessage(input.message, { isTest: input.isTest });
    const config = input.target.type === "destination" ? parseDestinationConfig("SLACK", input.target.destination.config) : null;
    if (config?.mode === "webhook" && input.target.type === "destination") {
      const url = openDestinationSecrets(input.target.destination.secretEnc).webhookUrl;
      if (!url || webhookUrlProblem("SLACK", url)) return invalidTarget;
      const result = await postSlackWebhook(url, { ...payload, ...(threadRoot(input.thread) ? { thread_ts: threadRoot(input.thread) } : {}) });
      return result.ok ? { ok: true } : failToSendResult(result);
    }
    const bot = botTarget(input, "SLACK");
    if (!bot) return invalidTarget;
    let channel = bot.identity?.dmChannelId ?? (config?.mode === "bot" ? config.channelId : null);
    if (!channel && bot.identity) {
      const dm = await openSlackDm(bot.credentials.botToken, bot.identity.externalUserId);
      if (!dm.ok) return failToSendResult(dm);
      channel = dm.data.channel.id;
    }
    if (!channel) return invalidTarget;
    const root = threadRoot(input.thread);
    const result = await postSlackMessage(bot.credentials.botToken, { channel, ...payload, ...(root ? { thread_ts: root } : {}) });
    return result.ok ? { ok: true, providerMessageId: result.data.ts, providerThreadId: root ?? result.data.ts } : failToSendResult(result);
  },
};
