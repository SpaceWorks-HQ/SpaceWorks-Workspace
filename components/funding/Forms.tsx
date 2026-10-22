"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFunding, fundingOperation } from "@/app/actions/funding";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DETAIL_FIELDS, MONEY_KINDS, PARENT_KIND } from "@/lib/funding/fields";
import { LABELS, STATUSES, human, type Kind } from "@/lib/funding/schema";
import { object } from "@/lib/funding/analytics";
import { currencyMinorDigits, parseMoneyToMinor } from "@/lib/format/money";
import type { FundingData } from "@/lib/funding/service";

type Choices = Pick<FundingData, "people" | "contacts" | "organisations" | "services" | "subscriptions" | "funds" | "choices">;
function major(value: unknown, currency: string) { return typeof value === "number" ? String(value / 10 ** currencyMinorDigits(currency)) : ""; }
export function RecordForm({ slug, kind, row, data, defaultCurrency }: { slug: string; kind: Kind; row?: FundingData["selected"]; data: Choices; defaultCurrency: string }) {
  const [pending, start] = useTransition(); const [error, setError] = useState(""); const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({}); const [currency, setCurrency] = useState(row?.currency ?? defaultCurrency); const router = useRouter(); const errorRef = useRef<HTMLParagraphElement>(null); const prefix = useId();
  const details = object(row?.details); const parentKind = PARENT_KIND[kind];
  const options = (source: string) => source === "people" ? data.people.map(m => ({ id: m.user.id, name: `${m.user.name ?? "Former member"}${m.status === "SUSPENDED" ? " (suspended)" : ""}` })) : source === "contacts" ? data.contacts.map(c => ({ id: c.id, name: c.displayName })) : source === "organisations" ? data.organisations : source === "services" ? data.services : source === "subscriptions" ? data.subscriptions : data.choices.filter(c => c.kind === source).map(c => ({ id: c.id, name: c.title }));
  const commonError = (key: string) => fieldErrors[key]?.join(" ");
  return <form className="space-y-5" onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); setError(""); setFieldErrors({});
    start(async () => {
      try {
        const detail: Record<string, unknown> = {};
        for (const f of DETAIL_FIELDS[kind]) {
          const value = String(form.get(`detail.${f.key}`) ?? "");
          if (f.type === "boolean") detail[f.key] = value === "on";
          else if (f.type === "number") detail[f.key] = value ? Number(value) : undefined;
          else if (f.type === "money") { const minor = value ? parseMoneyToMinor(value, currency) : 0; if (minor === null) throw new Error(`Enter a valid ${f.label.toLowerCase()}.`); detail[f.key] = minor; }
          else detail[f.key] = value;
        }
        const amountInput = String(form.get("amountMinor") ?? ""); const amountMinor = amountInput ? parseMoneyToMinor(amountInput, currency) : 0; if (amountMinor === null) throw new Error("Enter a valid amount for this currency.");
        const input = { id: row?.id ?? "", kind, title: String(form.get("title")), status: String(form.get("status")), ownerId: String(form.get("ownerId") ?? ""), parentId: String(form.get("parentId") ?? ""), fundId: String(form.get("fundId") ?? ""), contactId: String(form.get("contactId") ?? ""), organisationId: String(form.get("organisationId") ?? ""), dateOn: String(form.get("dateOn") ?? ""), dueOn: String(form.get("dueOn") ?? ""), endsOn: String(form.get("endsOn") ?? ""), amountMinor, currency: currency.toUpperCase(), notes: String(form.get("notes") ?? ""), reminderDays: Number(form.get("reminderDays") ?? 7), details: detail };
        const result = await saveFunding(slug, input);
        if (!result.ok) { setError(result.error); setFieldErrors(result.fieldErrors ?? {}); requestAnimationFrame(() => errorRef.current?.focus()); return; }
        router.push(`/w/${slug}/funding/${kind === "OPPORTUNITY" ? "tracker" : ["GRANT", "FUNDER", "INSTALMENT", "REPORT", "DELIVERABLE"].includes(kind) ? "grants" : ["PROGRAMME", "KPI", "IMPACT_ENTRY"].includes(kind) ? "impact" : kind === "RUNWAY" ? "runway" : ["TOOL_ACCOUNT", "ACCESS_REVIEW"].includes(kind) ? "access" : "donations"}?edit=${result.data?.id}`); router.refresh();
      } catch (cause) { setError(cause instanceof Error && !cause.message.includes("fetch") ? cause.message : "Couldn't save. Try again."); }
    });
  }}>
    <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger-fg">{error}</p>
    <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-title">{row ? "Edit" : "Add"} {LABELS[kind].toLowerCase()}</legend>
      <Field label="Name" required error={commonError("title")}><Input name="title" defaultValue={row?.title ?? ""} maxLength={200} /></Field>
      <Field label="Status" error={commonError("status")}><Dropdown name="status" defaultValue={row?.status ?? STATUSES[kind][0]}>{STATUSES[kind].filter(s => s !== "SIGNED").map(s => <option key={s} value={s}>{human(s)}</option>)}</Dropdown></Field>
      <Field label="Owner" optional error={commonError("ownerId")}><Dropdown name="ownerId" defaultValue={row?.ownerId ?? ""}><option value="">Unassigned</option>{data.people.filter(p => p.status === "ACTIVE" && ["ADMIN", "OWNER"].includes(p.role)).map(m => <option key={m.user.id} value={m.user.id}>{m.user.name ?? "Former member"}</option>)}</Dropdown></Field>
      {parentKind ? <Field label={LABELS[parentKind]} required error={commonError("parentId")}><Dropdown name="parentId" defaultValue={row?.parentId ?? ""}><option value="">Choose a record</option>{options(parentKind).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Dropdown></Field> : null}
      {["DONATION", "PLEDGE", "DONOR", "OPPORTUNITY"].includes(kind) ? <Field label="CRM contact" optional={kind === "OPPORTUNITY"} required={kind !== "OPPORTUNITY"} error={commonError("contactId")} helperText="Create contacts in the existing CRM."><Dropdown name="contactId" defaultValue={row?.contactId ?? ""}><option value="">Choose a contact</option>{options("contacts").map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Dropdown></Field> : null}
      {["GRANT", "FUNDER", "OPPORTUNITY"].includes(kind) ? <Field label="CRM organisation" optional={kind === "OPPORTUNITY"} required={kind !== "OPPORTUNITY"} error={commonError("organisationId")} helperText="Use the existing CRM organisation as the funder."><Dropdown name="organisationId" defaultValue={row?.organisationId ?? ""}><option value="">Choose an organisation</option>{data.organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Dropdown></Field> : null}
      {["GRANT", "DONATION", "OPPORTUNITY"].includes(kind) ? <Field label="Finance fund" optional error={commonError("fundId")}><Dropdown name="fundId" defaultValue={row?.fundId ?? ""}><option value="">No fund linked</option>{data.funds.filter(f => f.currency === currency).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</Dropdown></Field> : null}
      {MONEY_KINDS.includes(kind) || kind === "OPPORTUNITY" ? <Field label="Currency" required error={commonError("currency")}><Input name="currency" value={currency} maxLength={3} onChange={e => setCurrency(e.target.value.toUpperCase())} /></Field> : null}
      {MONEY_KINDS.includes(kind) ? <Field label={kind === "CAMPAIGN" ? "Goal" : kind === "RUNWAY" ? "Opening cash balance" : kind === "DONATION" ? "Amount or in-kind estimated value" : "Amount"} required error={commonError("amountMinor")} helperText={`In ${currency}; enter major units, for example 1250.50.`}><Input name="amountMinor" inputMode="decimal" defaultValue={major(row?.amountMinor, currency)} /></Field> : null}
      <Field label={kind === "RUNWAY" ? "Month (first day)" : kind === "DONATION" ? "Gift date" : kind === "IMPACT_ENTRY" ? "Entry date" : "Start or record date"} optional={!["DONATION", "RUNWAY", "IMPACT_ENTRY", "GRANT", "CAMPAIGN"].includes(kind)} error={commonError("dateOn")}><Input name="dateOn" type="date" defaultValue={row?.dateOn?.toISOString().slice(0, 10) ?? ""} /></Field>
      <Field label={kind === "OPPORTUNITY" ? "Next action due" : "Due date"} optional={!parentKind} error={commonError("dueOn")}><Input name="dueOn" type="date" defaultValue={row?.dueOn?.toISOString().slice(0, 10) ?? ""} /></Field>
      <Field label="End date" optional={!["GRANT", "CAMPAIGN"].includes(kind)} error={commonError("endsOn")}><Input name="endsOn" type="date" defaultValue={row?.endsOn?.toISOString().slice(0, 10) ?? ""} /></Field>
      <Field label={kind === "DONATION" ? "Thank-you reminder days after gift" : "Remind days before"} error={commonError("reminderDays")}><Input name="reminderDays" type="number" min={0} max={90} defaultValue={row?.reminderDays ?? 7} /></Field>
      {DETAIL_FIELDS[kind].map(f => {
        const name = `detail.${f.key}`; const value = details[f.key] ?? (f.key === "year" ? new Date().getFullYear() : f.key === "receiptPrefix" ? "DON/" : f.type === "choice" ? f.choices?.[0] ?? "" : "");
        return <Field key={f.key} id={`${prefix}-${f.key}`} label={f.label} optional={!f.required && f.type !== "boolean"} required={f.required} helperText={f.helper} error={commonError(`details.${f.key}`)}>
          {f.type === "choice" || f.type === "ref" ? <Dropdown name={name} defaultValue={String(value)}>{f.type === "ref" ? <option value="">Choose a record</option> : null}{f.type === "ref" ? options(f.source!).map(o => <option key={o.id} value={o.id}>{o.name}</option>) : f.choices!.map(v => <option key={v} value={v}>{human(v)}</option>)}</Dropdown> : f.type === "textarea" ? <Textarea name={name} defaultValue={String(value)} maxLength={2000} /> : f.type === "boolean" ? <input type="checkbox" name={name} defaultChecked={value === true} className="size-6 accent-accent" /> : <Input name={name} type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} step={f.type === "number" ? "any" : undefined} inputMode={f.type === "money" ? "decimal" : undefined} defaultValue={f.type === "money" ? major(value, currency) : String(value)} maxLength={f.type === "text" ? 200 : undefined} />}
        </Field>;
      })}
      <Field label="Notes" optional className="sm:col-span-2" error={commonError("notes")}><Textarea name="notes" defaultValue={row?.notes ?? ""} maxLength={10000} /></Field>
    </fieldset>
    {commonError("details") ? <p role="alert" className="text-danger-fg">{commonError("details")}</p> : null}
    <Button type="submit" variant="primary" loading={pending}>Save {LABELS[kind].toLowerCase()}</Button>
  </form>;
}
export function OperationButton({ slug, input, children, confirm }: { slug: string; input: unknown; children: React.ReactNode; confirm?: string }) {
  const [pending, start] = useTransition(); const [message, setMessage] = useState(""); const [open, setOpen] = useState(false); const router = useRouter();
  const run = () => start(async () => { try { const result = await fundingOperation(slug, input); setMessage(result.ok ? "Saved." : result.error); if (result.ok) router.refresh(); } catch { setMessage("Couldn't save. Try again."); } });
  return <div className="min-w-0"><Button loading={pending} variant={confirm ? "danger" : "secondary"} onClick={() => confirm ? setOpen(true) : run()}>{children}</Button><p role="status" className="text-caption">{message}</p>{confirm ? <ConfirmDialog open={open} title={confirm} message="Review this change before continuing." confirmLabel="Confirm change" onCancel={() => setOpen(false)} onConfirm={() => { setOpen(false); run(); }} /> : null}</div>;
}
export function QuarterForm({ slug }: { slug: string }) {
  const [quarter, setQuarter] = useState(`${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}`);
  return <div className="flex flex-wrap items-end gap-3"><Field label="Quarter" helperText="Creates one checklist per active account; retries keep existing reviews."><Input value={quarter} onChange={e => setQuarter(e.target.value)} maxLength={7} /></Field><OperationButton slug={slug} input={{ op: "quarter", quarter }}>Prepare quarterly reviews</OperationButton></div>;
}
export function DonorPreferences({ slug, rowId, contact }: { slug: string; rowId: string; contact: FundingData["contacts"][number] }) {
  const [channel, setChannel] = useState(contact.preferredChannel ?? "NONE"); const [consent, setConsent] = useState(contact.consentStatus ?? "UNKNOWN"); const [stop, setStop] = useState(contact.doNotContact); const [source, setSource] = useState(contact.consentSource ?? "");
  return <section className="space-y-3"><h3 className="text-title">Contact preferences</h3><div className="grid gap-3 sm:grid-cols-2"><Field label="Preferred contact"><Dropdown value={channel} onChange={e => setChannel(e.target.value)}>{["EMAIL", "PHONE", "POST", "NONE"].map(v => <option key={v} value={v}>{human(v)}</option>)}</Dropdown></Field><Field label="Consent to be contacted"><Dropdown value={consent} onChange={e => setConsent(e.target.value)}>{["GRANTED", "DENIED", "UNKNOWN"].map(v => <option key={v} value={v}>{human(v)}</option>)}</Dropdown></Field><Field label="Consent source"><Input value={source} onChange={e => setSource(e.target.value)} maxLength={200} /></Field><Field label="Do not contact"><input type="checkbox" checked={stop} onChange={e => setStop(e.target.checked)} className="size-6 accent-accent" /></Field></div><OperationButton slug={slug} input={{ op: "donorPreferences", id: rowId, preferredChannel: channel, consentStatus: consent, doNotContact: stop, consentSource: source }}>Save contact preferences</OperationButton></section>;
}
