import type { DestinationKind, MessagingProvider } from "@prisma/client";
import { z } from "zod";

/**
 * Notification destination settings per kind (pure and client-safe: the
 * routing UI builds its form from this, the server validates with it, and
 * the provider adapters read `config` through `parseDestinationConfig`).
 *
 * `NotificationDestination.config` holds only non-secret settings.
 * Webhook URLs and signing secrets go in `secretEnc` as JSON
 * `DestinationSecrets` (purpose "notification-secrets", see
 * lib/integrations/destinationSecrets.ts) and are write-only in the UI.
 */

export const DESTINATION_KINDS = ["IN_APP_USERS", "WORKSPACE_CHANNEL", "EMAIL", "SLACK", "DISCORD", "MATTERMOST", "TELEGRAM", "WHATSAPP", "WEBHOOK"] as const satisfies readonly DestinationKind[];

export const DESTINATION_KIND_LABEL: Record<DestinationKind, string> = {
  IN_APP_USERS: "In-app (people)",
  WORKSPACE_CHANNEL: "Workspace channel",
  EMAIL: "Email",
  SLACK: "Slack",
  DISCORD: "Discord",
  MATTERMOST: "Mattermost",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
  WEBHOOK: "Webhook",
};

/** Messaging connection a bot-mode destination needs (connectionId column). */
export const DESTINATION_PROVIDER: Partial<Record<DestinationKind, MessagingProvider>> = {
  SLACK: "SLACK",
  DISCORD: "DISCORD",
  MATTERMOST: "MATTERMOST",
  TELEGRAM: "TELEGRAM",
  WHATSAPP: "WHATSAPP",
};

const id = z.string().trim().min(1).max(64);
const ids = z.array(id).max(500).optional();
const roles = z.array(z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"])).max(4).optional();
const memberSelectable = z.boolean().optional();
const externalId = z.string().trim().min(1, "Enter the channel id.").max(128);

export const peopleConfigSchema = z.object({ userIds: ids, roles, teamIds: ids, memberSelectable });

export const destinationConfigSchemas = {
  IN_APP_USERS: peopleConfigSchema.refine((value) => Boolean(value.userIds?.length || value.roles?.length || value.teamIds?.length), "Pick at least one person, role or team."),
  WORKSPACE_CHANNEL: z.object({ channelId: id, memberSelectable }),
  EMAIL: z
    .object({ to: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses.").max(320)).max(50).optional(), userIds: ids, roles, teamIds: ids })
    .refine((value) => Boolean(value.to?.length || value.userIds?.length || value.roles?.length || value.teamIds?.length), "Add an email address or pick people."),
  SLACK: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("webhook"), channelLabel: z.string().max(80).optional() }),
    z.object({ mode: z.literal("bot"), channelId: externalId, channelLabel: z.string().max(80).optional() }),
  ]),
  DISCORD: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("webhook"), threadId: z.string().regex(/^\d{5,25}$/, "Thread ids are numbers.").optional(), channelLabel: z.string().max(80).optional() }),
    z.object({ mode: z.literal("bot"), channelId: z.string().regex(/^\d{5,25}$/, "Discord channel ids are numbers."), channelLabel: z.string().max(80).optional() }),
  ]),
  MATTERMOST: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("webhook"), channelLabel: z.string().max(80).optional() }),
    z.object({ mode: z.literal("bot"), channelId: externalId, channelLabel: z.string().max(80).optional() }),
  ]),
  TELEGRAM: z.object({
    chatId: z.string().trim().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/, "Use the numeric chat id or @channelname."),
    messageThreadId: z.number().int().positive().optional(),
    channelLabel: z.string().max(80).optional(),
  }),
  WHATSAPP: z.object({
    to: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use the full number with country code, e.g. +919876543210."),
    templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Template names are lowercase letters, numbers and underscores.").optional(),
    templateLanguage: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a language code such as en or en_US.").optional(),
  }),
  WEBHOOK: z.object({ urlHint: z.string().max(200).optional() }),
} satisfies Record<DestinationKind, z.ZodType>;

export type DestinationConfig<K extends DestinationKind> = z.infer<(typeof destinationConfigSchemas)[K]>;

/** Secret part of a destination, stored encrypted in `secretEnc`. */
export const destinationSecretsSchema = z.object({
  webhookUrl: z.string().trim().max(2048).optional(),
  signingSecret: z.string().min(16, "Signing secrets need at least 16 characters.").max(256).optional(),
});
export type DestinationSecrets = z.infer<typeof destinationSecretsSchema>;

/** Which secrets a kind/mode needs from the form (always write-only). */
export function requiredSecrets(kind: DestinationKind, mode?: string): Array<keyof DestinationSecrets> {
  if (kind === "WEBHOOK") return ["webhookUrl", "signingSecret"];
  if ((kind === "SLACK" || kind === "DISCORD" || kind === "MATTERMOST") && mode === "webhook") return ["webhookUrl"];
  return [];
}

/** Whether a kind/mode posts through a MessagingConnection (bot token). */
export function needsConnection(kind: DestinationKind, mode?: string): boolean {
  if (kind === "TELEGRAM" || kind === "WHATSAPP") return true;
  return (kind === "SLACK" || kind === "DISCORD" || kind === "MATTERMOST") && mode === "bot";
}

/** Strict host rules for provider incoming-webhook URLs (others go through the SSRF guard). */
export function webhookUrlProblem(kind: DestinationKind, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter the full webhook URL.";
  }
  if (kind === "SLACK" && !(url.protocol === "https:" && url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/"))) {
    return "Slack webhook URLs start with https://hooks.slack.com/services/.";
  }
  if (
    kind === "DISCORD" &&
    !(url.protocol === "https:" && ["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(url.hostname) && /^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname))
  ) {
    return "Discord webhook URLs look like https://discord.com/api/webhooks/<id>/<token>.";
  }
  if (kind === "MATTERMOST" && !/\/hooks\/[a-z0-9]{10,}$/i.test(url.pathname)) return "Mattermost webhook URLs end with /hooks/<id>.";
  return null;
}

/** Parse a stored config for a kind; null when it no longer matches the schema. */
export function parseDestinationConfig<K extends DestinationKind>(kind: K, config: unknown): DestinationConfig<K> | null {
  const parsed = destinationConfigSchemas[kind].safeParse(config ?? {});
  return parsed.success ? (parsed.data as DestinationConfig<K>) : null;
}

/** Short, non-secret description of where a destination sends ("#ops", "+91…3210", "hooks.example.com"). */
export function describeDestination(kind: DestinationKind, config: unknown): string {
  const raw = (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as Record<string, unknown>;
  const label = typeof raw.channelLabel === "string" && raw.channelLabel ? raw.channelLabel : null;
  switch (kind) {
    case "EMAIL": {
      const to = Array.isArray(raw.to) ? raw.to.length : 0;
      const people = (Array.isArray(raw.userIds) ? raw.userIds.length : 0) + (Array.isArray(raw.roles) ? raw.roles.length : 0) + (Array.isArray(raw.teamIds) ? raw.teamIds.length : 0);
      return [to ? `${to} ${to === 1 ? "address" : "addresses"}` : null, people ? "selected people" : null].filter(Boolean).join(" and ") || "No recipients";
    }
    case "IN_APP_USERS":
      return Array.isArray(raw.roles) && raw.roles.length ? `Roles: ${raw.roles.join(", ").toLowerCase()}` : "Selected people";
    case "WORKSPACE_CHANNEL":
      return label ?? "Workspace channel";
    case "TELEGRAM":
      return label ?? (typeof raw.chatId === "string" ? `Chat ${raw.chatId}` : "Telegram chat");
    case "WHATSAPP":
      return typeof raw.to === "string" ? `${raw.to.slice(0, 4)}…${raw.to.slice(-4)}` : "WhatsApp number";
    case "WEBHOOK":
      return typeof raw.urlHint === "string" && raw.urlHint ? raw.urlHint : "Webhook";
    default:
      return label ?? (raw.mode === "webhook" ? "Incoming webhook" : typeof raw.channelId === "string" ? raw.channelId : DESTINATION_KIND_LABEL[kind]);
  }
}
