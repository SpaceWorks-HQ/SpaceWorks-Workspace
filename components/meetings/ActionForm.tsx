"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actionResult";

export type FormField = {
  name: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "datetime-local"
    | "select"
    | "checkbox"
    | "multi"
    | "single"
    | "ranked"
    | "lines"
    | "tags";
  options?: { value: string; label: string }[];
  value?: string | number | boolean;
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
};
export type FormAction = (
  slug: string,
  input: unknown,
) => Promise<ActionResult<unknown>>;

function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1))
    current = (current[part] ??= {}) as Record<string, unknown>;
  current[parts.at(-1)!] = value;
}

export function ActionForm({
  slug,
  action,
  fields = [],
  hidden = {},
  label,
  navigateTo,
  reset = false,
  confirm,
  destructive = false,
  primary = false,
}: {
  slug: string;
  action: FormAction;
  fields?: FormField[];
  hidden?: Record<string, unknown>;
  label: string;
  navigateTo?: string;
  reset?: boolean;
  confirm?: string;
  destructive?: boolean;
  primary?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const requestId = useRef<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmed = useRef(false);
  return (
    <form
      ref={formRef}
      className="space-y-4"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        if (confirm && !confirmed.current) {
          setConfirmOpen(true);
          return;
        }
        confirmed.current = false;
        const form = new FormData(event.currentTarget);
        const input: Record<string, unknown> = { ...hidden };
        for (const field of fields) {
          const raw = String(form.get(field.name) ?? "");
          let value: unknown = raw;
          if (field.type === "checkbox") value = form.has(field.name);
          else if (field.type === "multi")
            value = form.getAll(field.name).map(String);
          else if (field.type === "single") value = raw ? [raw] : [];
          else if (field.type === "ranked")
            value = (field.options ?? [])
              .map((_, i) => String(form.get(`${field.name}.${i}`) ?? ""))
              .filter(Boolean);
          else if (field.type === "lines")
            value = raw
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean);
          else if (field.type === "tags")
            value = raw
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
          else if (field.type === "number") {
            if (!raw && !field.required) continue;
            value = Number(raw);
          } else if (field.type === "datetime-local") {
            if (!raw && field.name in hidden) continue;
            value = raw ? new Date(raw).toISOString() : null;
          }
          setPath(input, field.name, value);
        }
        requestId.current ??= crypto.randomUUID();
        input.requestId ??= requestId.current;
        setError("");
        setFieldErrors({});
        setSaved(false);
        setCreatedUrl(null);
        startTransition(async () => {
          try {
            const result = await action(slug, input);
            if (!result.ok) {
              setError(result.error);
              setFieldErrors(result.fieldErrors ?? {});
              requestAnimationFrame(() => errorRef.current?.focus());
              return;
            }
            setSaved(true);
            requestId.current = null;
            const data = result.data as
              | { id?: string; url?: string }
              | undefined;
            if (
              typeof data?.url === "string" &&
              data.url.startsWith(`/w/${slug}/`)
            )
              setCreatedUrl(data.url);
            if (navigateTo && data?.id)
              router.push(`${navigateTo}${encodeURIComponent(data.id)}`);
            else router.refresh();
            if (reset) formRef.current?.reset();
          } catch {
            setError("Couldn't save. Try again.");
            requestAnimationFrame(() => errorRef.current?.focus());
          }
        });
      }}
    >
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {fields.map((field) => {
          const options = field.options ?? [];
          const errorText = fieldErrors[field.name]?.join(" ");
          if (field.type === "multi" || field.type === "single")
            return (
              <fieldset
                key={field.name}
                aria-describedby={`${formId}-${field.name}-help`}
                className="space-y-1"
              >
                <legend className="text-label">{field.label}</legend>
                {field.help ? (
                  <p
                    id={`${formId}-${field.name}-help`}
                    className="text-caption text-ink-muted"
                  >
                    {field.help}
                  </p>
                ) : null}
                {options.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-subtle"
                  >
                    <input
                      type={field.type === "multi" ? "checkbox" : "radio"}
                      name={field.name}
                      value={option.value}
                      className="size-5 accent-[var(--yy-primary)]"
                      required={field.type === "single" && field.required}
                    />
                    {option.label}
                  </label>
                ))}
                {errorText ? (
                  <p className="text-danger-fg text-caption">{errorText}</p>
                ) : null}
              </fieldset>
            );
          if (field.type === "ranked")
            return (
              <fieldset key={field.name} className="space-y-3">
                <legend className="text-label">{field.label}</legend>
                <p className="text-caption text-ink-muted">
                  Choose your first choice, then the next. You can leave later
                  ranks empty. Ties for elimination use the displayed option
                  order.
                </p>
                {options.map((_, i) => (
                  <Field key={i} label={`Rank ${i + 1}`}>
                    <Dropdown name={`${field.name}.${i}`} defaultValue="">
                      <option value="">No choice</option>
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Dropdown>
                  </Field>
                ))}
              </fieldset>
            );
          if (field.type === "checkbox")
            return (
              <label
                key={field.name}
                className="flex min-h-11 items-center gap-3"
              >
                <input
                  name={field.name}
                  type="checkbox"
                  defaultChecked={field.value === true}
                  className="size-5 accent-[var(--yy-primary)]"
                  required={field.required}
                />
                {field.label}
              </label>
            );
          return (
            <Field
              key={field.name}
              label={field.label}
              required={field.required}
              optional={!field.required}
              helperText={field.help}
              error={errorText}
            >
              {field.type === "select" ? (
                <Dropdown
                  name={field.name}
                  defaultValue={String(field.value ?? options[0]?.value ?? "")}
                  required={field.required}
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Dropdown>
              ) : ["textarea", "lines"].includes(field.type ?? "") ? (
                <Textarea
                  name={field.name}
                  defaultValue={String(field.value ?? "")}
                  required={field.required}
                  maxLength={50_000}
                />
              ) : (
                <Input
                  name={field.name}
                  type={field.type === "tags" ? "text" : (field.type ?? "text")}
                  defaultValue={String(field.value ?? "")}
                  required={field.required}
                  min={field.min}
                  max={field.max}
                  maxLength={
                    field.type === "text" || !field.type ? 500 : undefined
                  }
                  step={field.type === "number" ? "any" : undefined}
                />
              )}
            </Field>
          );
        })}
        <Button
          type="submit"
          variant={destructive ? "danger" : primary ? "primary" : "secondary"}
          disabled={pending}
        >
          {pending ? "Saving…" : label}
        </Button>
      </fieldset>
      {error ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-danger-border bg-danger-bg p-3 text-danger-fg"
        >
          {error}
        </p>
      ) : null}
      <p role="status" className="text-caption text-ink-muted">
        {saved ? "Saved." : ""}
      </p>
      {createdUrl ? (
        <a
          href={createdUrl}
          className="inline-flex min-h-11 items-center text-accent-text underline"
        >
          Open created work
        </a>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          open={confirmOpen}
          title={label.replace(/…$/, "")}
          message={confirm}
          destructive={destructive}
          confirmLabel={label.replace(/…$/, "")}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            confirmed.current = true;
            setConfirmOpen(false);
            formRef.current?.requestSubmit();
          }}
        />
      ) : null}
    </form>
  );
}
