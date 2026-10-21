import type { DigestFrequency, MessagingProvider, PersonalChannel, WorkspaceRole } from "@prisma/client";
import { NOTIFY_CATEGORIES, type NotifyCategory } from "@/lib/notify/events";

/**
 * Personal channel resolution (pure). Order: the member's own row for the
 * category → the workspace default row → reminders on every available channel
 * → the catalogue default. In-app is
 * always on (the notification centre is the record); other channels need a
 * verified account link, and guests only get in-app and email.
 */

export type PreferenceRow = { channels: PersonalChannel[]; digestFrequency: DigestFrequency };

/** Provider whose verified ExternalIdentityLink unlocks each DM channel. */
export const DM_CHANNEL_PROVIDER: Record<Exclude<PersonalChannel, "IN_APP" | "EMAIL">, MessagingProvider> = {
  TELEGRAM_DM: "TELEGRAM",
  SLACK_DM: "SLACK",
  DISCORD_DM: "DISCORD",
  MATTERMOST_DM: "MATTERMOST",
  WHATSAPP_DM: "WHATSAPP",
};

export function availablePersonalChannels(role: WorkspaceRole, linkedProviders: Iterable<MessagingProvider>): Set<PersonalChannel> {
  const available = new Set<PersonalChannel>(["IN_APP", "EMAIL"]);
  if (role === "GUEST") return available;
  const linked = new Set(linkedProviders);
  for (const [channel, provider] of Object.entries(DM_CHANNEL_PROVIDER)) {
    if (linked.has(provider)) available.add(channel as PersonalChannel);
  }
  return available;
}

/**
 * Reminders and due/overdue/expiring alerts are worth interrupting for, so when
 * a member has no explicit preference for the category they reach every channel
 * the member can receive: email and each linked messaging account.
 */
export function isReminderEvent(type: string) {
  return /(?:reminder|_due|\.due|overdue|expiring)$/.test(type);
}

export function resolvePersonalChannels(input: {
  category: NotifyCategory;
  eventType?: string;
  role: WorkspaceRole;
  userPreference?: PreferenceRow | null;
  workspaceDefault?: PreferenceRow | null;
  linkedProviders: Iterable<MessagingProvider>;
}): { channels: PersonalChannel[]; digestFrequency: DigestFrequency } {
  const row = input.userPreference ?? input.workspaceDefault ?? null;
  const available = availablePersonalChannels(input.role, input.linkedProviders);
  const wanted: PersonalChannel[] = row
    ? row.channels
    : input.eventType && isReminderEvent(input.eventType)
      ? [...available]
      : [...NOTIFY_CATEGORIES[input.category].defaultChannels];
  const channels = new Set<PersonalChannel>(["IN_APP"]);
  for (const channel of wanted) if (available.has(channel)) channels.add(channel);
  return { channels: [...channels], digestFrequency: row?.digestFrequency ?? "IMMEDIATE" };
}

/** When a held digest item is due (the digest job may batch more coarsely). */
export function digestDueAt(frequency: DigestFrequency, now: Date): Date | null {
  const hour = 3_600_000;
  const nextHour = Math.ceil((now.getTime() + 1) / hour) * hour;
  switch (frequency) {
    case "HOURLY":
      return new Date(nextHour);
    case "DAILY":
      return new Date(nextHour + 23 * hour);
    case "WEEKLY":
      return new Date(nextHour + (7 * 24 - 1) * hour);
    default:
      return null;
  }
}
