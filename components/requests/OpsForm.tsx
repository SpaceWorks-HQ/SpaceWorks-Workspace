"use client";
import { useState, useTransition, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import type { ActionResult } from "@/lib/actionResult";
export type Option = { value: string; label: string };
export type OpsField = { name: string; label: string; type?: string; required?: boolean; value?: string; options?: Option[]; multiple?: boolean; checked?: boolean; helper?: string };
export function OpsForm({ action, fields = [], label, hidden = {}, children, confirm }: { action: (data: FormData) => Promise<ActionResult<string>>; fields?: OpsField[]; label: string; hidden?: Record<string,string>; children?: ReactNode; confirm?: string }) {
 const [pending, start] = useTransition(); const [message, setMessage] = useState(""); const [ok, setOk] = useState(false); const [confirmed, setConfirmed] = useState(false); const router = useRouter(); const ref = useRef<HTMLFormElement>(null);
 return <form ref={ref} className="min-w-0 space-y-4 break-words" aria-busy={pending} action={data => start(async () => {
  setMessage("");
  try { const result = await action(data); setOk(result.ok); setMessage(result.ok ? result.data ?? "Saved." : result.error); if (result.ok) { ref.current?.reset(); router.refresh(); setConfirmed(false); } }
  catch { setOk(false); setMessage("Couldn't save. Try again."); }
 })}>
  {Object.entries(hidden).map(([name,value]) => <input key={name} type="hidden" name={name} value={value} />)}
  <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&>*]:min-w-0">{fields.map(f => f.type === "checkbox" ? <div key={f.name} className="flex min-h-11 items-center"><CheckboxField name={f.name} label={f.label} defaultChecked={f.checked} /></div> : f.multiple && f.options ? <fieldset key={f.name} className="space-y-2"><legend className="mb-2 text-label">{f.label}</legend>{f.options.map(o => <CheckboxField key={o.value} name={f.name} value={o.value} label={o.label} defaultChecked={f.value?.split(",").includes(o.value)} />)}{!f.options.length && <p className="text-caption text-ink-muted">None available yet.</p>}</fieldset> : <Field key={f.name} label={f.label} required={f.required} optional={!f.required} helperText={f.helper}>
   {f.options ? <Dropdown name={f.name} defaultValue={f.value ?? ""}>{!f.required && <option value="">None</option>}{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Dropdown> : f.type === "textarea" ? <Textarea name={f.name} defaultValue={f.value} maxLength={5000} /> : <Input name={f.name} type={f.type ?? "text"} defaultValue={f.value} maxLength={f.type === "password" ? 20000 : 2000} autoComplete={f.type === "password" ? "new-password" : undefined} multiple={f.type === "file"} />}
  </Field>)}</div>
  {children}
  {confirm && !confirmed ? <Button type="button" variant="danger" onClick={() => setConfirmed(true)}>{label}…</Button> : <div className="flex flex-wrap gap-2">{confirm && <p className="w-full text-body-ui">{confirm}</p>}<Button type="submit" disabled={pending} variant={confirm ? "dangerSolid" : "primary"}>{pending ? "Saving…" : label}</Button>{confirm && <Button type="button" variant="secondary" onClick={() => setConfirmed(false)}>Cancel</Button>}</div>}
  {message && <p role={ok ? "status" : "alert"} className={ok ? "break-words text-body-ui text-accent-text" : "text-body-ui text-danger-fg"}>{ok && message.startsWith("/f/") ? <><a href={message} className="underline" target="_blank" rel="noreferrer">Open public form</a><span className="block">Save this link now: {typeof window !== "undefined" ? window.location.origin : ""}{message}</span></> : message}</p>}
 </form>;
}
