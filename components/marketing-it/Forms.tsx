"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveMarketingIt, archiveMarketingIt, decideMarketingItAccess, completeMarketingItReview } from "@/app/actions/marketingIt";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { LABELS, STATUSES, object, human, path, type Kind } from "@/lib/marketingIt/schema";
import { FIELDS } from "@/lib/marketingIt/fields";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import { parseMoneyToMinor, currencyMinorDigits } from "@/lib/format/money";
import type { ToolData } from "@/lib/marketingIt/service";
import type { ActionResult } from "@/lib/actionResult";
export function RecordForm({ slug, timezone, currency, kind, data }: { slug: string; timezone: string; currency: string; kind: Kind; data: ToolData }) {
 const row = data.selected, d = object(row?.details), router = useRouter(), errorRef = useRef<HTMLParagraphElement>(null);
 const [pending, start] = useTransition(), [error, setError] = useState("");
 const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
 const [selectedAsset, setSelectedAsset] = useState(row?.assetId ?? "");
 const asset = data.assets.find(a => a.id === selectedAsset);
 const options = (source: string) => source === "integrations" ? data.integrations.map(i => ({ id: i.id, name: `${i.provider} · ${i.accountLabel}` })) : source === "contacts" ? data.contacts.map(c => ({ id: c.id, name: c.displayName })) : source === "posts" ? data.posts.map(p => ({ id: p.id, name: p.text.slice(0, 90) || "Published post" })) : source === "funding" ? data.funding.map(f => ({ id: f.id, name: f.title })) : source === "deals" ? data.deals.map(f => ({ id: f.id, name: f.title })) : source === "accounts" ? data.accounts.map(a => ({ id: a.id, name: a.displayName })) : source === "docs" ? data.docs.map(a => ({ id: a.id, name: a.title })) : source === "incidents" ? data.incidents.map(a => ({ id: a.id, name: a.title })) : source === "backups" ? data.backups.map(a => ({ id: a.id, name: `${a.kind} · ${a.startedAt.toISOString().slice(0, 10)} · ${human(a.status)}` })) : source === "assets" ? data.assets : data.organisations;
 return <form className="space-y-4" onSubmit={e => {
  e.preventDefault(); const form = new FormData(e.currentTarget); setError(""); setFieldErrors({});
  start(async () => { try {
   const details: Record<string, unknown> = {};
   for (const f of FIELDS[kind]) {
    const value = String(form.get(`detail.${f.key}`) ?? "");
    if (f.type === "boolean") details[f.key] = value === "on";
    else if (f.type === "number") details[f.key] = Number(value);
    else if (f.type === "money") { const minor = parseMoneyToMinor(value || "0", String(form.get("detail.currency") || currency)); if (minor === null) throw new Error("Enter a valid proposal value."); details[f.key] = minor; }
    else if (f.type === "instant") { const iso = value ? zonedInputToIso(value, timezone) : ""; if (value && !iso) throw new Error("That time doesn't exist in this time zone. Choose another time."); details[f.key] = iso; }
    else details[f.key] = value;
   }
   if (kind === "LICENCE") details.assigneeIds = form.getAll("assigneeIds");
   const result = await saveMarketingIt(slug, { id: row?.id ?? "", kind, title: form.get("title"), status: form.get("status"), ownerId: form.get("ownerId") ?? "", assetId: form.get("assetId") ?? "", subscriptionId: form.get("subscriptionId") ?? "", dateOn: form.get("dateOn") ?? "", dueOn: form.get("dueOn") ?? "", reminderDays: Number(form.get("reminderDays") ?? 1), notes: form.get("notes"), details });
   if (!result.ok) { setError(result.error); setFieldErrors(result.fieldErrors ?? {}); requestAnimationFrame(() => errorRef.current?.focus()); return; }
   router.push(`${path(slug, kind)}&edit=${result.data?.id}`); router.refresh();
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save. Try again."); requestAnimationFrame(() => errorRef.current?.focus()); } });
 }}>
  <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger-fg">{error}</p>
  <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
   <legend className="mb-3 text-title">{row ? "Edit record" : `Add to ${LABELS[kind].toLowerCase()}`}</legend>
   <Field label="Title" required error={fieldErrors.title?.join(" ")}><Input name="title" defaultValue={row?.title} maxLength={200} /></Field>
   <Field label="Status" error={fieldErrors.status?.join(" ")}><Dropdown name="status" defaultValue={row?.status ?? STATUSES[kind][0]}>{STATUSES[kind].filter(s => kind !== "REVIEW" || s !== "COMPLETED").map(s => <option key={s} value={s}>{human(s)}</option>)}</Dropdown></Field>
   <Field label={kind === "DEVICE" ? "Assignee (clear on return)" : "Owner"} error={fieldErrors.ownerId?.join(" ")}><Dropdown key={kind === "DEVICE" && !row ? selectedAsset : "owner"} name="ownerId" defaultValue={row?.ownerId ?? (kind === "DEVICE" ? asset?.ownerUserId ?? "" : data.userId)}><option value="">Unassigned</option>{data.people.filter(p => p.status === "ACTIVE" && (data.admin ? ["CONTENT", "DEVICE"].includes(kind) || p.role !== "MEMBER" : p.user.id === data.userId)).map(p => <option key={p.user.id} value={p.user.id}>{p.user.name ?? "Former member"}</option>)}</Dropdown></Field>
   {kind === "DEVICE" ? <Field label="Existing asset" required helperText="Create inventory in Assets. This register uses the same device." error={fieldErrors.assetId?.join(" ")}><Dropdown name="assetId" value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}><option value="">Choose an asset</option>{data.assets.filter(a => !row || a.id === row.assetId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Dropdown></Field> : null}
   {kind === "LICENCE" ? <Field label="Licence subscription" required helperText="Manage renewals in Subscriptions." error={fieldErrors.subscriptionId?.join(" ")}><Dropdown name="subscriptionId" defaultValue={row?.subscriptionId ?? ""}><option value="">Choose a licence</option>{data.subscriptions.filter(s => !row || s.id === row.subscriptionId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Dropdown></Field> : null}
   {["PROPOSAL", "REVIEW", "RESTORE"].includes(kind) ? <><Field label={kind === "RESTORE" ? "Test date" : "Record date"}><Input type="date" name="dateOn" defaultValue={row?.dateOn?.toISOString().slice(0, 10)} /></Field><Field label={kind === "PROPOSAL" ? "Follow-up date" : kind === "RESTORE" ? "Next restore test" : "Review due"} required={kind !== "PROPOSAL"}><Input type="date" name="dueOn" defaultValue={row?.dueOn?.toISOString().slice(0, 10)} /></Field></> : null}
   {FIELDS[kind].map(f => {
    const stored = d[f.key] ?? (f.key === "currency" ? currency : f.key === "seats" ? 1 : f.key === "serial" ? asset?.serialNumber : f.key === "purchasedOn" ? asset?.purchaseDate?.toISOString().slice(0, 10) : f.key === "condition" ? asset?.condition : "");
    const value = f.type === "instant" && stored ? zonedDatetimeLocalValue(new Date(String(stored)), timezone) : f.type === "money" && typeof stored === "number" ? String(stored / 10 ** currencyMinorDigits(String(d.currency || currency))) : String(stored ?? "");
    return <Field key={`${f.key}-${!row && kind === "DEVICE" ? selectedAsset : ""}`} label={f.type === "instant" ? `${f.label} (${timezone})` : f.label} className={f.type === "textarea" ? "sm:col-span-2" : ""} error={fieldErrors[`details.${f.key}`]?.join(" ")}>
     {f.type === "select" ? <Dropdown name={`detail.${f.key}`} defaultValue={value || f.values?.[0] || ""}>{f.source ? <option value="">None</option> : null}{f.values?.map(v => <option key={v} value={v}>{human(v)}</option>)}{f.source ? options(f.source).map(o => <option key={o.id} value={o.id}>{o.name}</option>) : null}</Dropdown> : f.type === "textarea" ? <Textarea name={`detail.${f.key}`} defaultValue={value} maxLength={10000} /> : f.type === "boolean" ? <input className="size-11 accent-accent" type="checkbox" name={`detail.${f.key}`} defaultChecked={typeof stored === "boolean" ? stored : true} /> : <Input type={f.type === "instant" ? "datetime-local" : f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} name={`detail.${f.key}`} defaultValue={value} min={f.type === "number" ? 1 : undefined} inputMode={f.type === "money" ? "decimal" : undefined} maxLength={f.key === "currency" ? 3 : 300} />}
    </Field>;
   })}
   {kind === "LICENCE" ? <fieldset className="space-y-2 sm:col-span-2"><legend className="text-label">Assigned seats</legend>{data.people.filter(p => p.role !== "GUEST" && p.status === "ACTIVE").map(p => <label key={p.user.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" name="assigneeIds" value={p.user.id} defaultChecked={(d.assigneeIds as string[] | undefined)?.includes(p.user.id)} className="size-5 accent-accent" />{p.user.name ?? "Former member"}</label>)}</fieldset> : null}
   <Field label="Remind before due date (days)"><Input name="reminderDays" type="number" min={0} max={90} defaultValue={row?.reminderDays ?? 1} /></Field>
   <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={row?.notes} maxLength={10000} /></Field>
  </fieldset>
  <Button type="submit" disabled={pending}>{pending ? "Saving" : "Save record"}</Button>
 </form>;
}
export function ActionButton({ children, action, confirm }: { children: ReactNode; action: () => Promise<ActionResult<unknown>>; confirm?: string }) {
 const [pending, start] = useTransition(), [message, setMessage] = useState(""), [open, setOpen] = useState(false), router = useRouter();
 const run = () => start(async () => { try { const result = await action(); setMessage(result.ok ? "Saved." : result.error); router.refresh(); } catch { setMessage("Couldn't save. Try again."); } });
 return <div><Button variant="secondary" disabled={pending} onClick={() => confirm ? setOpen(true) : run()}>{pending ? "Saving" : children}</Button><p role="status">{message}</p>{confirm ? <ConfirmDialog open={open} title={confirm} message="Your saved history will be kept." confirmLabel="Confirm" onCancel={() => setOpen(false)} onConfirm={() => { setOpen(false); run(); }} /> : null}</div>;
}
export function ArchiveButton({ slug, id, archived }: { slug: string; id: string; archived: boolean }) { return <ActionButton action={() => archiveMarketingIt(slug, id, !archived)} confirm={archived ? "Restore record?" : "Archive record?"}>{archived ? "Restore record" : "Archive record"}</ActionButton>; }
export function CompleteButton({ slug, id }: { slug: string; id: string }) { return <ActionButton action={() => completeMarketingItReview(slug, id)} confirm="Complete this access review?">Complete review</ActionButton>; }
export function ReviewDecision({ slug, recordId, item }: { slug: string; recordId: string; item: { id: string; decision: string; note: string } }) {
 const [pending, start] = useTransition(), [message, setMessage] = useState(""), router = useRouter();
 return <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); start(async () => { try { const result = await decideMarketingItAccess(slug, { recordId, itemId: item.id, decision: form.get("decision"), note: form.get("note") }); setMessage(result.ok ? "Decision saved." : result.error); router.refresh(); } catch { setMessage("Couldn't save. Try again."); } }); }}><Field label="Decision"><Dropdown name="decision" defaultValue={item.decision}><option value="PENDING" disabled>Choose a decision</option><option value="KEEP">Keep</option><option value="REVOKE">Revoke manually</option></Dropdown></Field><Field label="Review note" required><Input name="note" defaultValue={item.note} maxLength={2000} /></Field><Button type="submit" disabled={pending}>{pending ? "Saving" : "Save decision"}</Button><p role="status">{message}</p></form>;
}
