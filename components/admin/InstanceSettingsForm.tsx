"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateInstanceSettingsAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, Chip, SettingsRow } from "@/components/ui/display";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

export type SettingView = { key: string; secret: boolean; value: string | null; isSet: boolean; source: "database" | "environment" | "unset" };

const GROUPS: Array<{ title: string; description: string; fields: Array<{ key: string; label: string; help?: string }> }> = [
  {
    title: "Email (SMTP)",
    description: "Used for invitations and password resets. Brevo on port 2525 works on most hosts.",
    fields: [
      { key: "smtp.from", label: "From address", help: "e.g. Space Works <hello@example.org>" },
      { key: "smtp.host", label: "SMTP host" },
      { key: "smtp.port", label: "SMTP port" },
      { key: "smtp.secure", label: "Implicit TLS", help: "\"true\" for port 465, otherwise \"false\"." },
      { key: "smtp.user", label: "SMTP user" },
      { key: "smtp.password", label: "SMTP password" },
    ],
  },
  {
    title: "Google sign-in",
    description: "Lets invited members sign in with the same Google email. Never creates accounts.",
    fields: [
      { key: "google.clientId", label: "OAuth client ID" },
      { key: "google.clientSecret", label: "OAuth client secret" },
    ],
  },
  {
    title: "Assistant",
    description: "Anthropic API key and model for the Space Works Assistant.",
    fields: [
      { key: "ai.anthropicApiKey", label: "Anthropic API key" },
      { key: "ai.model", label: "Model", help: "Defaults to claude-opus-5-5." },
    ],
  },
];

function SourceChip({ setting }: { setting: SettingView | undefined }) {
  if (!setting?.isSet) return <Chip tone="neutral" size="sm">Not set</Chip>;
  return setting.source === "database" ? <Chip tone="success" size="sm">Saved</Chip> : <Chip tone="info" size="sm">From environment</Chip>;
}

export function InstanceSettingsForm({ settings }: { settings: SettingView[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(settings.filter((s) => !s.secret).map((s) => [s.key, s.value ?? ""])));
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          // Non-secret fields left empty are cleared; empty secrets stay unchanged.
          const payload: Record<string, string | null> = {};
          for (const setting of settings) {
            const value = values[setting.key] ?? "";
            if (setting.secret) {
              if (value.trim()) payload[setting.key] = value;
            } else {
              payload[setting.key] = value.trim() ? value : null;
            }
          }
          const result = await updateInstanceSettingsAction(payload);
          if (!result.ok) {
            showToast(result.error, "error");
            return;
          }
          setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !byKey.get(key)?.secret)));
          showToast("Instance settings saved.", "success");
          router.refresh();
        });
      }}
    >
      <Card padding="lg">
        {GROUPS.map((group) => (
          <SettingsRow key={group.title} title={group.title} description={group.description}>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.fields.map((field) => {
                const setting = byKey.get(field.key);
                const label = <span className="inline-flex items-center gap-2">{field.label} <SourceChip setting={setting} /></span>;
                return (
                  <Field key={field.key} label={label} helperText={setting?.secret ? "Write-only. Leave empty to keep the saved value." : field.help}>
                    {setting?.secret ? (
                      <PasswordInput value={values[field.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))} autoComplete="off" />
                    ) : (
                      <Input value={values[field.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))} autoComplete="off" />
                    )}
                  </Field>
                );
              })}
            </div>
          </SettingsRow>
        ))}
        <div className="flex justify-end pt-6">
          <Button type="submit" variant="primary" loading={pending}>Save settings</Button>
        </div>
      </Card>
    </form>
  );
}
