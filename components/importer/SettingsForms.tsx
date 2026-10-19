"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestWorkspaceExport,
  saveRetentionPolicy,
  saveWorkspaceShellSettings,
} from "@/app/actions/exports";
import { saveOidcProvider } from "@/app/actions/platformShell";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { Dropdown } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actionResult";
function useSave() {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return {
    message,
    pending,
    save: (action: () => Promise<ActionResult>, after?: () => void) =>
      start(async () => {
        try {
          const r = await action();
          setMessage(r.ok ? "Saved." : r.error);
          if (r.ok) {
            after?.();
            router.refresh();
          }
        } catch {
          setMessage("Couldn't save. Try again.");
        }
      }),
  };
}
export function ExportForm({ slug }: { slug: string }) {
  const s = useSave();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        s.save(() =>
          requestWorkspaceExport(slug, {
            includeMessages: f.get("messages") === "on",
            format: f.get("format"),
          }),
        );
      }}
    >
      <Field label="Bundle format">
        <Dropdown name="format" defaultValue="ZIP_JSON">
          <option value="ZIP_JSON">ZIP with JSON</option>
          <option value="JSON">JSON</option>
        </Dropdown>
      </Field>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="messages" />
        Include public workspace channel messages
      </label>
      <Button type="submit" loading={s.pending}>
        Request export
      </Button>
      <p role="status">{s.message}</p>
    </form>
  );
}
export function JobRefresh({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [pending, router]);
  return null;
}
export function RetentionForm({
  slug,
  area,
  label,
  days,
}: {
  slug: string;
  area: string;
  label: string;
  days: number | null;
}) {
  const s = useSave();
  const [proposed, setProposed] = useState<number | null | undefined>(
    undefined,
  );
  return (
    <>
      <form
        className="flex flex-wrap items-end gap-3 border-t border-line py-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const days = f.get("days") ? Number(f.get("days")) : null;
          if (days === null)
            s.save(() =>
              saveRetentionPolicy(slug, { entityType: area, keepDays: null }),
            );
          else setProposed(days);
        }}
      >
        <Field
          label={`${label}: days to keep`}
          helperText="Leave blank to keep indefinitely."
        >
          <Input
            type="number"
            name="days"
            min={1}
            max={36500}
            defaultValue={days ?? ""}
          />
        </Field>
        <Button type="submit" variant="secondary" loading={s.pending}>
          Save {label.toLowerCase()}
        </Button>
        <p role="status" className="text-caption">
          {s.message}
        </p>
      </form>
      <ConfirmDialog
        open={proposed !== undefined}
        title={`Set retention for ${label.toLowerCase()}?`}
        message={`Records older than ${proposed} days will be permanently removed by the scheduled worker unless legal hold is active.`}
        confirmLabel="Set retention"
        loading={s.pending}
        onCancel={() => setProposed(undefined)}
        onConfirm={() =>
          s.save(
            () =>
              saveRetentionPolicy(slug, {
                entityType: area,
                keepDays: proposed ?? null,
              }),
            () => setProposed(undefined),
          )
        }
      />
    </>
  );
}
export function ShellSettingsForm({
  slug,
  locale,
  legalHold,
}: {
  slug: string;
  locale: string;
  legalHold: boolean;
}) {
  const s = useSave();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        s.save(() =>
          saveWorkspaceShellSettings(slug, {
            legalHold: f.get("hold") === "on",
            defaultLocale: f.get("locale"),
          }),
        );
      }}
    >
      <Field
        label="Default locale"
        helperText="A language and region code, such as en-IN. Untranslated messages use English."
      >
        <Input name="locale" maxLength={80} defaultValue={locale} required />
      </Field>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="hold" defaultChecked={legalHold} />
        Legal hold: pause all platform retention purges
      </label>
      <Button type="submit" loading={s.pending}>
        Save workspace settings
      </Button>
      <p role="status">{s.message}</p>
    </form>
  );
}
export type PublicOidc = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  allowedDomains: string[];
  enabled: boolean;
};
export function OidcForm({ provider }: { provider?: PublicOidc }) {
  const s = useSave();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        s.save(async () => {
          const r = await saveOidcProvider({
            id: provider?.id,
            name: f.get("name"),
            issuer: f.get("issuer"),
            clientId: f.get("clientId"),
            clientSecret: f.get("secret") || undefined,
            allowedDomains: String(f.get("domains") ?? "")
              .split(",")
              .map((d) => d.trim().toLowerCase())
              .filter(Boolean),
            enabled: f.get("enabled") === "on",
          });
          if (r.ok) {
            const secret = form.elements.namedItem(
              "secret",
            ) as HTMLInputElement | null;
            if (secret) secret.value = "";
          }
          return r;
        });
      }}
    >
      <Field label="Provider name" required>
        <Input name="name" maxLength={80} defaultValue={provider?.name} />
      </Field>
      <Field label="Issuer URL" required>
        <Input
          name="issuer"
          type="url"
          maxLength={500}
          defaultValue={provider?.issuer}
          readOnly={!!provider}
        />
      </Field>
      <Field label="Client ID" required>
        <Input
          name="clientId"
          maxLength={500}
          defaultValue={provider?.clientId}
          readOnly={!!provider}
        />
      </Field>
      <Field
        label={provider ? "Replace client secret" : "Client secret"}
        required={!provider}
        helperText={
          provider
            ? "Leave blank to keep the stored secret."
            : "Stored encrypted and never shown again."
        }
      >
        <PasswordInput
          name="secret"
          autoComplete="new-password"
          maxLength={4000}
        />
      </Field>
      <Field
        label="Allowed email domains"
        optional
        helperText="Comma-separated exact domains. Blank allows any verified email belonging to an existing active member."
      >
        <Input
          name="domains"
          defaultValue={provider?.allowedDomains.join(", ")}
          maxLength={2000}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-3">
        <input
          name="enabled"
          type="checkbox"
          defaultChecked={provider?.enabled ?? true}
        />
        Enable provider
      </label>
      <Button type="submit" loading={s.pending}>
        Save provider
      </Button>
      <p role="status">{s.message}</p>
    </form>
  );
}
