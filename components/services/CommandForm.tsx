"use client";
import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { serviceAction } from "@/app/actions/services";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Dropdown } from "@/components/ui/select";
import { zonedInputToIso } from "@/lib/timeZone";
export type FormField = { name: string; label: string; kind?: "text" | "password" | "number" | "textarea" | "json" | "checkbox" | "datetime" | "select" | "ids"; value?: string | number | boolean; options?: Array<{ value: string; label: string }>; help?: string; required?: boolean };
export function CommandForm({ slug, command, fixed = {}, fields = [], label = "Save changes", redirectTo, confirmText, children }: { slug: string; command: string; fixed?: Record<string, unknown>; fields?: FormField[]; label?: string; redirectTo?: string; confirmText?: string; children?: ReactNode }) {
  const [pending, start] = useTransition(), [message, setMessage] = useState(""), [result, setResult] = useState<Record<string, string> | undefined>();
  const router = useRouter(), formId = useId();
  return <form className="space-y-4" onSubmit={e => {
    e.preventDefault(); if (confirmText && !window.confirm(confirmText)) return;
    const form = new FormData(e.currentTarget), input: Record<string, unknown> = { command, ...fixed };
    try {
      for (const f of fields) {
        const raw = String(form.get(f.name) ?? "");
        input[f.name] = f.kind === "checkbox" ? form.has(f.name) : f.kind === "number" ? Number(raw) : f.kind === "json" ? JSON.parse(raw || "null") : f.kind === "ids" ? form.getAll(f.name).map(String) : f.kind === "datetime" ? zonedInputToIso(raw, String(fixed.timezone ?? "UTC")) : raw;
        if (raw === "" && f.kind !== "checkbox" && f.kind !== "ids" && f.name !== "postmortemMd") delete input[f.name];
      }
    } catch { setMessage("Check the JSON fields and try again."); return; }
    start(async () => { const response = await serviceAction(slug, input); setMessage(response.ok ? "Saved." : response.error); if (response.ok) { setResult(response.data); router.refresh(); if (redirectTo) router.push(redirectTo); } });
  }}>
    {fields.map(f => <div key={f.name} className="space-y-1.5"><label htmlFor={`${formId}-${f.name}`} className="block text-label text-ink">{f.label}</label>{f.kind === "checkbox" ? <input id={`${formId}-${f.name}`} name={f.name} type="checkbox" defaultChecked={Boolean(f.value)} className="size-5 accent-primary" /> : f.kind === "select" ? <Dropdown id={`${formId}-${f.name}`} name={f.name} defaultValue={String(f.value ?? "")} >{(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Dropdown> : f.kind === "ids" ? <div id={`${formId}-${f.name}`} role="group" aria-label={f.label} className="flex flex-wrap gap-3">{f.options?.map(o => <label key={o.value} className="flex min-h-11 items-center gap-2 text-label"><input type="checkbox" name={f.name} value={o.value} className="size-5 accent-primary" />{o.label}</label>)}</div> : f.kind === "textarea" || f.kind === "json" ? <Textarea id={`${formId}-${f.name}`} name={f.name} defaultValue={String(f.value ?? "")} required={f.required} rows={f.kind === "json" ? 5 : 3} /> : <Input id={`${formId}-${f.name}`} name={f.name} type={f.kind === "datetime" ? "datetime-local" : f.kind ?? "text"} defaultValue={String(f.value ?? "")} required={f.required} autoComplete={f.kind === "password" ? "new-password" : undefined} />}{f.help ? <p className="text-caption text-ink-muted">{f.help}</p> : null}</div>)}
    {children}<Button type="submit" variant={confirmText ? "danger" : "primary"} disabled={pending}>{pending ? "Saving" : label}</Button>
    <p role="status" aria-live="polite" className="text-body-ui text-ink-secondary">{message}</p>
    {result?.token ? <div className="rounded-lg border border-line bg-surface p-4"><p className="text-label">Copy this heartbeat URL now. It is shown once.</p><code className="block break-all">{window.location.origin}/api/hb/{result.token}</code><pre className="mt-3 overflow-x-auto text-caption">{`curl --fail '${window.location.origin}/api/hb/${result.token}'\n# Append /start before the job, /fail on failure, or /0 after success.`}</pre></div> : null}
    {result?.status ? <p role="status">{result.status}: {result.message}</p> : null}
  </form>;
}
