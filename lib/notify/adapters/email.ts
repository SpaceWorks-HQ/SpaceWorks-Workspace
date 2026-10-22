import "server-only";

import { prisma } from "@/lib/db";
import { escapeHtml, renderNotificationEmail } from "@/lib/email/templates";
import { parsePeopleSelector, resolveSelectorMembers } from "@/lib/notify/audience";
import type { DestinationAdapter } from "@/lib/notify/adapters/types";
import { enqueueEmail } from "@/lib/outbox";

/**
 * EMAIL destinations ({ to: string[] } and/or a people selector
 * { userIds, roles, teamIds }) and the EMAIL personal channel. Messages are
 * handed to the existing email outbox (`enqueueEmail`), which owns SMTP
 * delivery and its retries; "sent" here means queued for email.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function staticRecipients(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const to = (config as Record<string, unknown>).to;
  return Array.isArray(to) ? to.filter((v): v is string => typeof v === "string" && EMAIL.test(v) && v.length <= 320) : [];
}

export const emailAdapter: DestinationAdapter = {
  kind: "EMAIL",
  personalChannel: "EMAIL",
  label: "Email",
  configured: true,
  async send({ message, target, isTest }) {
    let recipients: string[];
    if (target.type === "personal") {
      recipients = [target.user.email];
    } else {
      const members = await resolveSelectorMembers(message.workspace.id, parsePeopleSelector(target.destination.config));
      recipients = [...staticRecipients(target.destination.config), ...members.map((member) => member.user.email)];
    }
    recipients = [...new Set(recipients.map((email) => email.toLowerCase()))].slice(0, 200);
    if (recipients.length === 0) return { ok: false, retryable: false, error: "This destination has no email recipients." };

    const lines = [message.text, `${message.severityLabel} · ${message.workspace.name}`].filter(Boolean);
    const email = renderNotificationEmail({
      title: `${isTest ? "[Test] " : ""}${message.title}`,
      bodyHtml: lines.map((line) => escapeHtml(line).replace(/\n/g, "<br>")).join("<br><br>"),
      ...(message.url ? { actionUrl: message.url, actionLabel: "Open in Space Works" } : {}),
    });
    await prisma.$transaction(async (tx) => {
      for (const to of recipients) await enqueueEmail(tx, { workspaceId: message.workspace.id, to, ...email });
    });
    return { ok: true };
  },
};
