"use client";
import { createContext, useActionState, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actionResult";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
const Errors = createContext<Record<string, string[]>>({});
export function OpsForm({ action, children, submit, hidden = {}, secondary = false }: { action: (form: FormData) => Promise<ActionResult<string>>; children?: ReactNode; submit: string; hidden?: Record<string, string>; secondary?: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (_previous: ActionResult<string> | null, form: FormData) => {
    try {
      const result = await action(form);
      if (result.ok) {
        if (result.data?.startsWith("/w/")) router.push(result.data);
        router.refresh();
      }
      return result;
    } catch { return { ok: false as const, error: "Couldn’t save. Check your connection and try again." }; }
  }, null);
  return <Errors.Provider value={state && !state.ok ? state.fieldErrors ?? {} : {}}><form action={formAction} className="space-y-4" aria-busy={pending}>
    {Object.entries(hidden).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <fieldset disabled={pending} className="min-w-0 space-y-4">{children}<Button type="submit" variant={secondary ? "secondary" : "primary"} loading={pending} loadingLabel="Saving…">{submit}</Button></fieldset>
    <div aria-live="polite" aria-atomic="true">{state ? state.ok ? <p role="status" className="text-sm text-success-fg">{state.data?.startsWith("/w/") ? "Saved. Opening the record…" : state.data}</p> : <p role="alert" className="text-sm text-danger-fg">{state.error}</p> : null}</div>
  </form></Errors.Provider>;
}
export function TextField({ name, label, type = "text", defaultValue, required = true, maxLength = 160, min, max, helper }: { name: string; label: string; type?: string; defaultValue?: string | number; required?: boolean; maxLength?: number; min?: string | number; max?: string | number; helper?: string }) {
  const errors = useContext(Errors);
  return <Field label={label} error={errors[name]?.join(" ")} required={required} helperText={helper}><Input name={name} type={type} defaultValue={defaultValue} maxLength={maxLength} min={min} max={max} step={type === "number" ? 1 : undefined} /></Field>;
}
export function LongField({ name, label, defaultValue, required = true, maxLength = 5000, helper }: { name: string; label: string; defaultValue?: string; required?: boolean; maxLength?: number; helper?: string }) {
  const errors = useContext(Errors);
  return <Field label={label} error={errors[name]?.join(" ")} required={required} helperText={helper}><Textarea name={name} defaultValue={defaultValue} maxLength={maxLength} /></Field>;
}
export function ChoiceField({ name, label, options, defaultValue, required = true }: { name: string; label: string; options: Array<{ value: string; label: string }>; defaultValue?: string; required?: boolean }) {
  const errors = useContext(Errors);
  return <Field label={label} error={errors[name]?.join(" ")} required={required}><Dropdown name={name} defaultValue={defaultValue ?? options[0]?.value} >{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Dropdown></Field>;
}
