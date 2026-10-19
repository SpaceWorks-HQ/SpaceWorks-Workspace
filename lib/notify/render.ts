import type { EventType, Severity } from "@/lib/notify/events";
import type { RenderedMessage } from "@/lib/notify/types";

/**
 * Channel-neutral rendering (pure). Adapters map the result to Block Kit,
 * embeds, HTML email and so on; this keeps one wording for every channel.
 */

const SEVERITY_LABEL: Record<Severity, string> = { info: "Info", warning: "Warning", critical: "Critical" };

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Only app-relative paths become links (never an arbitrary external URL from a payload). */
export function absoluteAppUrl(path: string | null | undefined, base = appBaseUrl()): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return `${base}${path}`;
}

export type StoredEventForRender = {
  type: string;
  severity: Severity;
  title: string;
  body?: string | null;
  url?: string | null;
  fields?: { label: string; value: string }[] | null;
  actions?: { id: string; label: string; url?: string | null }[] | null;
};

export function renderMessage(event: StoredEventForRender, workspace: RenderedMessage["workspace"], base = appBaseUrl()): RenderedMessage {
  const url = absoluteAppUrl(event.url, base);
  const fields = (event.fields ?? []).slice(0, 10).map((field) => ({ label: field.label.slice(0, 80), value: field.value.slice(0, 300) }));
  const textParts = [event.body?.trim() || null, ...fields.map((field) => `${field.label}: ${field.value}`)].filter(Boolean);
  return {
    title: event.title.slice(0, 150),
    text: textParts.join("\n").slice(0, 3000),
    url,
    severity: event.severity,
    severityLabel: SEVERITY_LABEL[event.severity],
    fields,
    actions: (event.actions ?? []).map((action) => ({ id: action.id, label: action.label, url: absoluteAppUrl(action.url ?? null, base) ?? url })),
    // Stored events were validated against the catalogue by dispatch().
    eventType: event.type as EventType,
    workspace,
  };
}

/** Plain-text rendering used by the workspace channel card and DM fallbacks. */
export function renderPlainText(message: RenderedMessage): string {
  const lines = [`${message.severity === "info" ? "" : `[${message.severityLabel}] `}${message.title}`];
  if (message.text) lines.push(message.text);
  if (message.url) lines.push(message.url);
  return lines.join("\n");
}
