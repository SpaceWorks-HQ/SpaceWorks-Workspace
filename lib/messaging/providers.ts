import type { MessagingProvider } from "@prisma/client";

/**
 * Messaging provider metadata (pure and client-safe). The connect form in
 * Settings › Messaging renders `credentialFields` (write-only, encrypted
 * with purpose "messaging-credentials") and `configFields` (plain JSON in
 * `MessagingConnection.config`).
 */

export const MESSAGING_PROVIDERS = ["SLACK", "DISCORD", "MATTERMOST", "TELEGRAM", "WHATSAPP"] as const satisfies readonly MessagingProvider[];

export const PROVIDER_LABEL: Record<MessagingProvider, string> = {
  SLACK: "Slack",
  DISCORD: "Discord",
  MATTERMOST: "Mattermost",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
};

/** URL path segment used by inbound routes: /api/integrations/<segment>/<connectionId>/… */
export const PROVIDER_SEGMENT: Record<MessagingProvider, string> = {
  SLACK: "slack",
  DISCORD: "discord",
  MATTERMOST: "mattermost",
  TELEGRAM: "telegram",
  WHATSAPP: "whatsapp",
};

/** Secret values per provider (JSON, encrypted). */
export type SlackCredentials = { botToken: string; signingSecret: string };
export type DiscordCredentials = { botToken: string };
export type MattermostCredentials = { botToken: string; commandToken?: string; outgoingToken?: string };
export type TelegramCredentials = { botToken: string; webhookSecret: string };
export type WhatsAppCredentials = { accessToken: string; appSecret: string; verifyToken: string };

export type ProviderCredentials = {
  SLACK: SlackCredentials;
  DISCORD: DiscordCredentials;
  MATTERMOST: MattermostCredentials;
  TELEGRAM: TelegramCredentials;
  WHATSAPP: WhatsAppCredentials;
};

/** Non-secret settings per provider (`MessagingConnection.config`). Filled partly by the verify step. */
export type SlackConfig = { teamId?: string; teamName?: string; botUserId?: string; appId?: string };
export type DiscordConfig = { applicationId?: string; publicKey?: string; guildId?: string; botUserId?: string; botUsername?: string };
export type MattermostConfig = { serverUrl?: string; botUserId?: string; botUsername?: string; teamId?: string };
export type TelegramConfig = { botId?: string; botUsername?: string };
export type WhatsAppConfig = {
  phoneNumberId?: string;
  businessAccountId?: string;
  displayNumber?: string;
  /** Approved template used outside the 24-hour service window. Its body takes one parameter: the notification text. */
  templateName?: string;
  templateLanguage?: string;
  graphVersion?: string;
};

export type ProviderConfig = {
  SLACK: SlackConfig;
  DISCORD: DiscordConfig;
  MATTERMOST: MattermostConfig;
  TELEGRAM: TelegramConfig;
  WHATSAPP: WhatsAppConfig;
};

export type FieldSpec = { key: string; label: string; help?: string; required: boolean; placeholder?: string };

export const CREDENTIAL_FIELDS: Record<MessagingProvider, FieldSpec[]> = {
  SLACK: [
    { key: "botToken", label: "Bot token", help: "OAuth & Permissions › Bot User OAuth Token (starts with xoxb-).", required: true, placeholder: "xoxb-…" },
    { key: "signingSecret", label: "Signing secret", help: "Basic Information › App Credentials.", required: true },
  ],
  DISCORD: [{ key: "botToken", label: "Bot token", help: "Developer Portal › Bot › Reset Token.", required: true }],
  MATTERMOST: [
    { key: "botToken", label: "Bot access token", help: "Integrations › Bot Accounts › Create token.", required: true },
    { key: "commandToken", label: "Slash command token", help: "Token of the /sw slash command, if you created one.", required: false },
    { key: "outgoingToken", label: "Outgoing webhook token", help: "Token of the outgoing webhook used for channel bridges.", required: false },
  ],
  TELEGRAM: [{ key: "botToken", label: "Bot token", help: "From @BotFather (/newbot).", required: true, placeholder: "123456:ABC…" }],
  WHATSAPP: [
    { key: "accessToken", label: "Access token", help: "A permanent System User token with whatsapp_business_messaging.", required: true },
    { key: "appSecret", label: "App secret", help: "App settings › Basic › App secret (verifies webhook signatures).", required: true },
  ],
};

export const CONFIG_FIELDS: Record<MessagingProvider, FieldSpec[]> = {
  SLACK: [],
  DISCORD: [
    { key: "publicKey", label: "Public key", help: "General Information › Public Key (verifies interactions).", required: true },
    { key: "guildId", label: "Server (guild) id", help: "Optional: register commands on one server instantly.", required: false },
  ],
  MATTERMOST: [{ key: "serverUrl", label: "Server URL", help: "For example https://chat.example.org.", required: true, placeholder: "https://" }],
  TELEGRAM: [],
  WHATSAPP: [
    { key: "phoneNumberId", label: "Phone number id", help: "WhatsApp › API Setup › Phone number ID.", required: true },
    { key: "businessAccountId", label: "Business account id", required: false },
    { key: "templateName", label: "Notification template", help: "Approved template with one body parameter, used outside the 24-hour window.", required: false, placeholder: "spaceworks_notification" },
    { key: "templateLanguage", label: "Template language", required: false, placeholder: "en" },
  ],
};

/** Slash command / keyword a member sends to link an account. */
export const LINK_COMMAND_HINT: Record<MessagingProvider, string> = {
  SLACK: "/sw link CODE (or DM the bot: link CODE)",
  DISCORD: "/link code:CODE",
  MATTERMOST: "/sw link CODE (or DM the bot: link CODE)",
  TELEGRAM: "/link CODE",
  WHATSAPP: "link CODE",
};
