"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actionResult";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { parseMoneyToMinor } from "@/lib/format/money";

export type FormField = { name: string; label: string; type?: "text" | "textarea" | "select" | "number" | "date" | "datetime-local" | "checkbox" | "email" | "choices"; value?: string | number | boolean | string[]; options?: { value: string; label: string }[]; required?: boolean; helper?: string; parse?: "tags" | "skills" | "nullable" | "number" | "nullableNumber" | "iso" | "money"; min?: number; max?: number; maxLength?: number };
type Mutation = (input: unknown) => Promise<ActionResult<unknown>>;
export function EditorForm({ fields, action, label = "Save changes", fixed = {}, afterUrl, resetOnSuccess = false }: { fields: FormField[]; action: Mutation; label?: string; fixed?: Record<string, unknown>; afterUrl?: string; resetOnSuccess?: boolean }) {
  const [pending, start] = useTransition(); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState(""); const [errors, setErrors] = useState<Record<string, string[]>>({}); const router = useRouter(); const { showToast } = useToast();
  return <form className="flex flex-col gap-4" onSubmit={e => {
    e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); const input: Record<string, unknown> = { ...fixed };
    for (const field of fields) {
      const value = String(fd.get(field.name) ?? ""); let parsed: unknown = field.type === "checkbox" ? fd.has(field.name) : value;
      if (field.type === "choices") parsed = fd.getAll(field.name).map(String);
      if (field.parse === "tags") parsed = value.split(",").map(s => s.trim()).filter(Boolean);
      if (field.parse === "skills") parsed = value.split(",").map(s => s.trim()).filter(Boolean).map(s => { const [skill, level] = s.split(":"); return { skill: skill.trim(), level: Number(level || 1) }; });
      if (field.parse === "nullable") parsed = value || null;
      if (field.parse === "number" || field.type === "number") parsed = Number(value);
      if (field.parse === "nullableNumber") parsed = value ? Number(value) : null;
      if (field.parse === "money") parsed = value ? parseMoneyToMinor(value, String(fd.get("currency") || fixed.currency || "INR")) ?? value : null;
      if (field.parse === "iso") parsed = value ? new Date(`${value}T12:00:00Z`).toISOString() : null;
      input[field.name] = parsed;
    }
    start(async () => { setError(null); setNotice(""); setErrors({}); try { const result = await action(input); if (!result.ok) { setError(result.error); setErrors(result.fieldErrors ?? {}); return; } const data = result.data as { duplicates?: string[] } | undefined; if (data?.duplicates?.length) setNotice(`Saved. Found ${data.duplicates.length} possible duplicate records. Search the directory before adding another.`); showToast("Changes saved", "success"); if (resetOnSuccess) form.reset(); if (afterUrl) router.push(afterUrl); router.refresh(); } catch { setError("Couldn't save. Try again."); } });
  }}>
    {fields.map(f => f.type === "choices" ? <fieldset key={f.name} className="flex min-w-0 flex-col gap-2"><legend className="mb-2 text-label">{f.label}</legend><div className="grid gap-2 sm:grid-cols-2">{f.options?.map(option => <label key={option.value} className="flex min-h-11 items-center gap-3 text-label"><input type="checkbox" name={f.name} value={option.value} defaultChecked={Array.isArray(f.value) && f.value.includes(option.value)} disabled={pending} className="size-5 accent-primary" />{option.label}</label>)}</div>{errors[f.name]?.length ? <p className="text-caption text-danger-fg">{errors[f.name].join(" ")}</p> : null}</fieldset> : f.type === "checkbox" ? <label key={f.name} className="flex min-h-11 items-center gap-3 text-label"><input type="checkbox" name={f.name} defaultChecked={Boolean(f.value)} disabled={pending} className="size-5 accent-primary" />{f.label}</label> : <Field key={f.name} label={f.label} error={errors[f.name]?.join(" ")} helperText={f.helper} required={f.required}>
      {f.type === "textarea" ? <Textarea name={f.name} defaultValue={String(f.value ?? "")} maxLength={f.maxLength ?? 8000} disabled={pending} /> : f.type === "select" ? <Dropdown name={f.name} defaultValue={String(f.value ?? "")} disabled={pending}>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Dropdown> : <Input name={f.name} type={f.type ?? "text"} defaultValue={String(f.value ?? "")} min={f.min} max={f.max} maxLength={f.maxLength ?? 2000} disabled={pending} />}
    </Field>)}
    {error ? <p role="alert" className="text-body-ui text-danger-fg">{error}</p> : null}
    {notice ? <p role="status" className="text-body-ui text-ink-secondary">{notice}</p> : null}
    <div><Button type="submit" loading={pending}>{label}</Button></div>
  </form>;
}
export function ActionButton({ action, input, children, destructive = false, confirm, variant = "secondary" }: { action: Mutation; input: unknown; children: React.ReactNode; destructive?: boolean; confirm?: string; variant?: "primary" | "secondary" | "quiet" }) {
  const [pending, start] = useTransition(); const [open, setOpen] = useState(false); const [error, setError] = useState(""); const router = useRouter();
  const act = () => start(async () => { try { const r = await action(input); if (!r.ok) { setError(r.error); return; } setError(""); setOpen(false); router.refresh(); } catch { setError("Couldn't save. Try again."); } });
  return <div className="flex flex-col gap-1"><Button variant={destructive ? "danger" : variant} loading={pending} onClick={() => confirm || destructive ? setOpen(true) : act()}>{children}</Button>{error ? <p role="alert" className="text-caption text-danger-fg">{error}</p> : null}<ConfirmDialog open={open} title={confirm || "Confirm this change"} message="Check the details before continuing." confirmLabel="Confirm change" destructive={destructive} loading={pending} onConfirm={act} onCancel={() => setOpen(false)} /></div>;
}
