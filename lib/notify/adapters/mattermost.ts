import "server-only";
import type { DestinationAdapter } from "./types";
import { parseDestinationConfig } from "@/lib/integrations/destinationConfig";
import { openDestinationSecrets } from "@/lib/integrations/destinationSecrets";
import { failToSendResult } from "@/lib/integrations/http";
import { createMattermostPost, postMattermostWebhook, openMattermostDm } from "@/lib/messaging/api/mattermost";
import { escapeMattermostMarkdown, truncate } from "@/lib/messaging/format/escape";
import { threadRoot } from "@/lib/messaging/format/message";
import { botTarget, invalidTarget } from "@/lib/messaging/targets";
export const mattermostAdapter: DestinationAdapter = {
  kind: "MATTERMOST", personalChannel: "MATTERMOST_DM", label: "Mattermost", configured: true,
  async send(input) {
    const text = truncate(escapeMattermostMarkdown(`${input.isTest ? "[Test] " : ""}${input.message.severityLabel}: ${input.message.title}\n${input.message.text}\n${input.message.url ?? ""}`), 16000);
    const config = input.target.type === "destination" ? parseDestinationConfig("MATTERMOST", input.target.destination.config) : null;
    if (config?.mode === "webhook" && input.target.type === "destination") {
      const url = openDestinationSecrets(input.target.destination.secretEnc).webhookUrl;
      if (!url) return invalidTarget;
      const result = await postMattermostWebhook(url, { text });
      return result.ok ? { ok: true } : failToSendResult(result);
    }
    const bot = botTarget(input, "MATTERMOST");
    if (!bot?.config.serverUrl) return invalidTarget;
    let channel = bot.identity?.dmChannelId ?? (config?.mode === "bot" ? config.channelId : null);
    if (!channel && bot.identity && bot.connection.botExternalId) {
      const dm = await openMattermostDm(bot.config.serverUrl, bot.credentials.botToken, bot.connection.botExternalId, bot.identity.externalUserId);
      if (!dm.ok) return failToSendResult(dm);
      channel = dm.data.id;
    }
    if (!channel) return invalidTarget;
    const root = threadRoot(input.thread);
    const result = await createMattermostPost(bot.config.serverUrl, bot.credentials.botToken, { channel_id: channel, message: text, ...(root ? { root_id: root } : {}) });
    return result.ok ? { ok: true, providerMessageId: result.data.id, providerThreadId: root ?? result.data.id } : failToSendResult(result);
  },
};
