"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DigestFrequency, PersonalChannel } from "@prisma/client";
import {
  saveNotificationPreference,
  saveNotificationSettings,
  removeNotificationMute,
} from "@/app/actions/notificationPreferences";
import {
  NOTIFY_CATEGORIES,
  EVENT_CATALOG,
  eventTypesByCategory,
  type NotifyCategory,
} from "@/lib/notify/events";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Dropdown } from "@/components/ui/select";
import { ActionButton } from "./ActionButton";
const CHANNELS: Record<PersonalChannel, string> = {
  IN_APP: "In-app",
  EMAIL: "Email",
  TELEGRAM_DM: "Telegram",
  SLACK_DM: "Slack",
  DISCORD_DM: "Discord",
  MATTERMOST_DM: "Mattermost",
  WHATSAPP_DM: "WhatsApp",
};
export function Preferences({
  slug,
  available,
  rows,
  quiet,
  snoozedUntil,
  critical,
  mutes,
  tz,
}: {
  slug: string;
  available: PersonalChannel[];
  rows: Array<{
    category: NotifyCategory;
    channels: PersonalChannel[];
    digestFrequency: DigestFrequency;
  }>;
  quiet: { start: string; end: string; tz: string; days?: number[] } | null;
  snoozedUntil: string | null;
  critical: boolean;
  mutes: Array<{ id: string; resourceType: string; resourceId: string }>;
  tz: string;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body-ui text-ink-secondary">
        In-app keeps a record of your updates. Link a messaging account to
        unlock its channel. Preferences apply to the events listed in each
        category.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full text-left text-label">
          <caption className="sr-only">
            Event categories and delivery channels
          </caption>
          <thead>
            <tr className="bg-surface">
              <th className="p-3">Events</th>
              <th className="p-3">Delivery preferences</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-line" key={row.category}>
                <th scope="row" className="p-3 align-top">
                  {NOTIFY_CATEGORIES[row.category].label}
                  <details className="mt-2 font-normal">
                    <summary className="min-h-11 cursor-pointer text-caption">
                      Included events
                    </summary>
                    <ul className="text-caption">
                      {eventTypesByCategory()[row.category].map((type) => (
                        <li key={type} className="py-1">
                          {EVENT_CATALOG[type].label}
                        </li>
                      ))}
                    </ul>
                  </details>
                </th>
                <td className="p-3">
                  <PreferenceRow slug={slug} row={row} available={available} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            try {
              const r = await saveNotificationSettings(slug, {
                quietHours:
                  fd.get("quiet") === "on"
                    ? {
                        start: fd.get("start"),
                        end: fd.get("end"),
                        tz: fd.get("tz"),
                        days: fd.getAll("days").map(Number),
                      }
                    : null,
                criticalBypassesQuiet: fd.get("critical") === "on",
                snoozeMinutes: Number(fd.get("snooze")),
              });
              setMessage(r.ok ? "Settings saved." : r.error);
              if (r.ok) router.refresh();
            } catch {
              setMessage("Couldn't save settings. Try again.");
            }
          });
        }}
      >
        <h2 className="text-title">Quiet hours and snooze</h2>
        <label className="flex min-h-11 items-center gap-3">
          <input name="quiet" type="checkbox" defaultChecked={!!quiet} />
          Enable quiet hours
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start">
            <Input
              name="start"
              type="time"
              defaultValue={quiet?.start ?? "22:00"}
            />
          </Field>
          <Field label="End">
            <Input
              name="end"
              type="time"
              defaultValue={quiet?.end ?? "07:00"}
            />
          </Field>
          <Field label="Time zone">
            <Input name="tz" defaultValue={quiet?.tz ?? tz} maxLength={100} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-label">Days quiet hours start</legend>
          <div className="flex flex-wrap gap-3">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => (
              <label key={day} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="days"
                  value={i + 1}
                  defaultChecked={!quiet?.days || quiet.days.includes(i + 1)}
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="critical" defaultChecked={critical} />
          Send critical alerts during quiet hours
        </label>
        <Field label="Snooze delivery">
          <Dropdown name="snooze" defaultValue="0">
            <option value="0">Resume now</option>
            <option value="60">For 1 hour</option>
            <option value="480">For 8 hours</option>
            <option value="1440">For 1 day</option>
            <option value="10080">For 1 week</option>
          </Dropdown>
        </Field>
        {snoozedUntil ? (
          <p className="text-caption">Delivery is currently snoozed.</p>
        ) : null}
        <Button type="submit" loading={pending}>
          Save settings
        </Button>
        <p role="status">{message}</p>
      </form>
      <section>
        <h2 className="text-title">Muted resources</h2>
        {mutes.length ? (
          <ul className="divide-y divide-line">
            {mutes.map((m) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                key={m.id}
              >
                <span>Muted {m.resourceType}</span>
                <ActionButton action={() => removeNotificationMute(slug, m.id)}>
                  Unmute
                </ActionButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-ink-muted">Nothing muted.</p>
        )}
      </section>
    </div>
  );
}
function PreferenceRow({
  slug,
  row,
  available,
}: {
  slug: string;
  row: {
    category: NotifyCategory;
    channels: PersonalChannel[];
    digestFrequency: DigestFrequency;
  };
  available: PersonalChannel[];
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          try {
            const r = await saveNotificationPreference(slug, {
              category: row.category,
              channels: fd.getAll("channels"),
              digestFrequency: fd.get("frequency"),
            });
            setMessage(r.ok ? "Saved." : r.error);
          } catch {
            setMessage("Couldn't save. Try again.");
          }
        });
      }}
    >
      <fieldset className="flex flex-wrap gap-x-4">
        <legend className="sr-only">
          {NOTIFY_CATEGORIES[row.category].label} channels
        </legend>
        {Object.entries(CHANNELS).map(([key, label]) => (
          <label key={key} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="channels"
              value={key}
              defaultChecked={row.channels.includes(key as PersonalChannel)}
              disabled={
                key === "IN_APP" || !available.includes(key as PersonalChannel)
              }
            />
            {label}
            {!available.includes(key as PersonalChannel)
              ? " (link account)"
              : ""}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={`${NOTIFY_CATEGORIES[row.category].label} frequency`}>
          <Dropdown name="frequency" defaultValue={row.digestFrequency}>
            {["IMMEDIATE", "HOURLY", "DAILY", "WEEKLY", "OFF"].map((f) => (
              <option value={f} key={f}>
                {f === "OFF"
                  ? "In-app only"
                  : f.charAt(0) + f.slice(1).toLowerCase()}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Button type="submit" loading={pending} variant="secondary">
          Save {NOTIFY_CATEGORIES[row.category].label.toLowerCase()}
        </Button>
        <span role="status" className="text-caption">
          {message}
        </span>
      </div>
    </form>
  );
}
