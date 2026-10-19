import "server-only";

import { discordAdapter } from "@/lib/notify/adapters/discord";
import { emailAdapter } from "@/lib/notify/adapters/email";
import { mattermostAdapter } from "@/lib/notify/adapters/mattermost";
import { slackAdapter } from "@/lib/notify/adapters/slack";
import { telegramAdapter } from "@/lib/notify/adapters/telegram";
import type { DestinationAdapter, ExternalPersonalChannel, QueuedDestinationKind } from "@/lib/notify/adapters/types";
import { webhookAdapter } from "@/lib/notify/adapters/webhook";
import { whatsappAdapter } from "@/lib/notify/adapters/whatsapp";
import { workspaceChannelAdapter } from "@/lib/notify/adapters/workspaceChannel";

/**
 * The adapter registry. Every module is imported here already; a provider
 * build replaces the export of its own file and never edits this one.
 */
export const DESTINATION_ADAPTERS: Record<QueuedDestinationKind, DestinationAdapter> = {
  WORKSPACE_CHANNEL: workspaceChannelAdapter,
  EMAIL: emailAdapter,
  SLACK: slackAdapter,
  DISCORD: discordAdapter,
  MATTERMOST: mattermostAdapter,
  TELEGRAM: telegramAdapter,
  WHATSAPP: whatsappAdapter,
  WEBHOOK: webhookAdapter,
};

export const PERSONAL_CHANNEL_ADAPTERS: Record<ExternalPersonalChannel, DestinationAdapter> = {
  EMAIL: emailAdapter,
  SLACK_DM: slackAdapter,
  DISCORD_DM: discordAdapter,
  MATTERMOST_DM: mattermostAdapter,
  TELEGRAM_DM: telegramAdapter,
  WHATSAPP_DM: whatsappAdapter,
};

export type { AdapterSendInput, DestinationAdapter, SendResult } from "@/lib/notify/adapters/types";
