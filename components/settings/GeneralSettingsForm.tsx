"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWorkspaceSettings } from "@/app/actions/workspace-settings";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/ui/choice";
import { Card, SettingsRow } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

type Values = {
  name: string;
  tagline: string;
  description: string;
  timezone: string;
  currency: string;
  financeVisibleToMembers: boolean;
};

export function GeneralSettingsForm({ slug, initial }: { slug: string; initial: Values }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updateWorkspaceSettings(slug, values);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            showToast(result.error, "error");
            return;
          }
          setErrors({});
          showToast("Settings saved.", "success");
          router.refresh();
        });
      }}
    >
      <Card padding="lg">
        <SettingsRow title="Details" description="Shown in the sidebar and invitations.">
          <div className="flex flex-col gap-4">
            <Field label="Workspace name" required error={errors.name?.[0]}>
              <Input value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
            </Field>
            <Field label="Tagline" optional error={errors.tagline?.[0]}>
              <Input value={values.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={140} />
            </Field>
            <Field label="About" optional error={errors.description?.[0]}>
              <Textarea value={values.description} onChange={(e) => set("description", e.target.value)} rows={4} maxLength={2000} />
            </Field>
          </div>
        </SettingsRow>
        <SettingsRow title="Region" description="Dates and the kitty use these everywhere.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Time zone" helperText="IANA name, e.g. Asia/Kolkata." error={errors.timezone?.[0]}>
              <Input value={values.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </Field>
            <Field label="Currency" helperText="Three-letter code, e.g. INR." error={errors.currency?.[0]}>
              <Input value={values.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} />
            </Field>
          </div>
        </SettingsRow>
        <SettingsRow title="Features" description="Admins always see finance.">
          <div className="flex flex-col gap-4">
            <SwitchRow label="Members can see the kitty" description="Show the finance summary to members. Guests never see it." checked={values.financeVisibleToMembers} onCheckedChange={(checked) => set("financeVisibleToMembers", checked)} />
          </div>
        </SettingsRow>
        <div className="flex justify-end pt-6">
          <Button type="submit" variant="primary" loading={pending}>Save changes</Button>
        </div>
      </Card>
    </form>
  );
}
