"use client";

import Link from "next/link";
import { CheckboxField } from "@/components/ui/choice";
import { Chip } from "@/components/ui/display";

export type PickableDestination = { id: string; name: string; kind: string; health: string };

const KIND_LABELS: Record<string, string> = {
  IN_APP_USERS: "In-app",
  WORKSPACE_CHANNEL: "Channel",
  EMAIL: "Email",
  SLACK: "Slack",
  DISCORD: "Discord",
  MATTERMOST: "Mattermost",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
  WEBHOOK: "Webhook",
};

/**
 * "Send to" picker over the workspace's notification destinations (from
 * `listPickableDestinations`). Whatever destinations exist show up here, so
 * new Slack/Telegram/… adapters need no change to this form.
 */
export function DestinationPicker({
  options,
  selected,
  onChange,
  settingsHref,
  disabled,
}: {
  options: PickableDestination[];
  selected: string[];
  onChange: (ids: string[]) => void;
  settingsHref: string | null;
  disabled?: boolean;
}) {
  if (options.length === 0) {
    return (
      <p className="rounded-md border border-line bg-surface px-3.5 py-3 text-body-ui text-ink-secondary">
        No destinations yet, so it goes to everyone in-app only.{" "}
        {settingsHref ? (
          <Link href={settingsHref} className="font-semibold text-accent-text underline underline-offset-4">
            Add one in notification settings
          </Link>
        ) : null}
      </p>
    );
  }
  const toggle = (id: string, on: boolean) => onChange(on ? [...new Set([...selected, id])] : selected.filter((value) => value !== id));
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="sr-only">Send to</legend>
      {options.map((option) => (
        <div key={option.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
          <CheckboxField
            label={option.name}
            checked={selected.includes(option.id)}
            onCheckedChange={(value) => toggle(option.id, value === true)}
          />
          <span className="flex shrink-0 items-center gap-1.5">
            {option.health === "ERROR" ? <Chip tone="danger" size="sm">Failing</Chip> : null}
            <Chip tone="neutral" size="sm">{KIND_LABELS[option.kind] ?? option.kind}</Chip>
          </span>
        </div>
      ))}
    </fieldset>
  );
}
