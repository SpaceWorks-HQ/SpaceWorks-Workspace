"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveProductRecord, saveProductOwnership } from "@/app/actions/productOps";
import { STATUSES, human, object, detailSchemas, type Kind, type EstimateLine } from "@/lib/productOps/schema";
import type { ProductData } from "@/lib/productOps/load";
import { parseMoneyToMinor } from "@/lib/format/money";
import { CostEditor } from "./CostEditor";
const control = "block min-h-11 w-full min-w-0 rounded-control border border-line-strong bg-panel px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-primary";
export function RecordForm({ slug, data, kind }: { slug: string; data: ProductData; kind: Kind }) {
 const router = useRouter(), uid = useId();
 const selected = data.selected, details = object(selected?.details), editing = Boolean(selected);
 const [project, setProject] = useState(selected?.projectId ?? "");
 const [repo, setRepo] = useState(String(details.repoId ?? ""));
 const [currency, setCurrency] = useState(selected?.currency ?? "INR");
 const [message, setMessage] = useState(""); const [pending, start] = useTransition();
 const [checks, setChecks] = useState<Array<{ title: string; done: boolean; note: string }>>(() => Array.isArray(details.checklist) ? details.checklist as Array<{ title: string; done: boolean; note: string }> : []);
 function text(name: string, label: string, options: { required?: boolean; area?: boolean; type?: string; value?: string | number } = {}) {
  const initial = options.value ?? (name in details ? String(details[name] ?? "") : "");
  return <label className="block min-w-0 text-label" htmlFor={`${uid}-${name}`}>{label}{options.area ? <textarea className={control} id={`${uid}-${name}`} name={name} defaultValue={initial} rows={4} maxLength={6000} required={options.required} /> : <input className={control} id={`${uid}-${name}`} name={name} defaultValue={initial} type={options.type ?? "text"} required={options.required} maxLength={250} />}</label>;
 }
 function select(name: string, label: string, choices: Array<{ id: string; title: string }>, initial?: string, required = false) {
  return <label className="block min-w-0 text-label" htmlFor={`${uid}-${name}`}>{label}<select className={control} id={`${uid}-${name}`} name={name} defaultValue={initial ?? String(details[name] ?? "")} required={required}><option value="">Choose {label.toLowerCase()}</option>{choices.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>;
 }
 function enumeration(name: string, label: string, choices: readonly string[], fallback: string) { return select(name,label,choices.map(id => ({id,title:human(id)})),String(details[name] ?? fallback),true); }
 function multi(name: string, label: string, choices: Array<{ id: string; title: string }>) { return <fieldset className="min-w-0 space-y-2"><legend className="text-label">{label}</legend><div className="max-h-60 overflow-auto rounded-lg border border-line p-2">{choices.length ? choices.map(c => <label key={c.id} className="flex min-h-11 items-center gap-2 break-words"><input type="checkbox" name={name} value={c.id} defaultChecked={Array.isArray(details[name]) && details[name].includes(c.id)} />{c.title}</label>) : <p className="text-caption text-ink-muted">No items in this project yet.</p>}</div></fieldset>; }
 return <form className="min-w-0 space-y-5 rounded-xl border border-line bg-panel p-4 sm:p-6" aria-describedby={`${uid}-message`} onSubmit={event => {
  event.preventDefault(); const form = new FormData(event.currentTarget); setMessage("");
  const get = (name: string) => String(form.get(name) ?? "");
  let facts: Record<string,unknown> = {};
  if (kind === "ROADMAP") facts = { horizon:get("horizon"), quarter:get("quarter"), ideaId:get("ideaId"), outcome:get("outcome") };
  if (kind === "RELEASE") facts = { repoId:repo, githubEventId:get("githubEventId"), version:get("version"), scope:get("scope"), taskIds:form.getAll("taskIds"), roadmapIds:form.getAll("roadmapIds"), checklist:checks, releaseNotes:get("releaseNotes") };
  if (kind === "ISSUE") facts = { type:get("type"), severity:get("severity"), steps:get("steps"), expected:get("expected"), environment:get("environment"), ideaId:get("ideaId") };
  if (kind === "QA_RUN") facts = { environment:get("environment"), checklist:checks, findings:get("findings") };
  if (kind === "PROTOTYPE") facts = { version:get("version"), designRevision:get("designRevision") };
  if (kind === "TEST") facts = { testPlan:get("testPlan"), results:get("results"), findings:get("findings"), designRevision:get("designRevision") };
  if (kind === "CHANGE") facts = { environment:get("environment"), changed:get("changed"), risk:get("risk"), rollback:get("rollback"), incidentId:get("incidentId"), requiresApproval:form.has("requiresApproval") };
  if (kind === "ESTIMATE") facts = { contingencyBps:Math.round(Number(get("contingency"))*100), revisionNote:get("revisionNote"), lines:Array.from({ length:Number(get("lineCount")) },(_,index) => ({ item:get(`line-${index}-item`), specification:get(`line-${index}-specification`), category:get(`line-${index}-category`), quantityMilli:Math.round(Number(get(`line-${index}-quantity`))*1000), unit:get(`line-${index}-unit`), unitCostMinor:parseMoneyToMinor(get(`line-${index}-cost`),currency) ?? -1, supplier:get(`line-${index}-supplier`), quoteUrl:get(`line-${index}-quoteUrl`), quoteFileId:get(`line-${index}-quoteFileId`), gstBps:Math.round(Number(get(`line-${index}-gst`))*100) })) };
  start(async () => {
   try { const result = await saveProductRecord(slug,{ id:selected?.id ?? "", revision:selected?.revision ?? 0, kind, title:get("title"), status:get("status"), projectId:project, ownerId:get("ownerId"), dueOn:get("dueOn"), dateOn:get("dateOn"), reminderDays:Number(get("reminderDays")), notes:get("notes"), currency, fundingId:get("fundingId"), budgetId:get("budgetId"), fundId:get("fundId"), releaseId:get("releaseId"), parentId:get("parentId"), details:facts });
    if (!result.ok) setMessage(result.error + (result.fieldErrors ? " " + Object.values(result.fieldErrors).flat().join(" ") : ""));
    else { router.push(`?edit=${result.data!.id}`); router.refresh(); setMessage("Changes saved."); }
   } catch { setMessage("Couldn't save. Try again."); }
  });
 }}>
 <h2 className="text-h2">{editing ? "Edit" : "Add"} {human(kind).toLowerCase()}</h2>
 {kind === "ESTIMATE" ? <p className="text-ink-muted">Prepare a funding budget from manually entered quantities and quotes. Each save keeps a revision.</p> : null}
 <fieldset className="min-w-0 space-y-5" disabled={pending || data.selectedLocked}><legend className="sr-only">Record details</legend>
 {text("title","Title",{required:true,value:selected?.title ?? ""})}
 <div className="grid min-w-0 gap-4 sm:grid-cols-2">
 <label className="text-label">Project<select className={control} name="projectId" value={project} onChange={e => { setProject(e.target.value); setRepo(""); }}><option value="">No project</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 {select("ownerId",kind === "RELEASE" ? "Technical owner" : "Owner",data.people.filter(p => kind !== "ESTIMATE" || ["ADMIN","OWNER"].includes(p.role)).map(p => ({id:p.user.id,title:p.user.name ?? "Member"})),selected?.ownerId ?? "",kind === "RELEASE")}
 {select("status","Status",STATUSES[kind].filter(s => !["IN_REVIEW","SHIPPED","APPLIED","ROLLED_BACK"].includes(s)).map(id => ({id,title:human(id)})), selected && !["IN_REVIEW","SHIPPED","APPLIED","ROLLED_BACK"].includes(selected.status) ? selected.status : STATUSES[kind][0],true)}
 {text("dueOn",kind === "RELEASE" ? "Target date" : "Due date",{type:"date",required:kind === "RELEASE",value:selected?.dueOn?.toISOString().slice(0,10) ?? ""})}
 {text("dateOn",kind === "TEST" ? "Test date" : "Record date",{type:"date",required:kind === "TEST",value:selected?.dateOn?.toISOString().slice(0,10) ?? ""})}
 <label className="text-label">Remind days before due date<input className={control} name="reminderDays" type="number" min="0" max="90" required defaultValue={selected?.reminderDays ?? 7}/></label>
 </div>
 {["ROADMAP","ISSUE","QA_RUN","CHANGE"].includes(kind) ? select("releaseId","Linked release",data.choices.filter(c => c.kind === "RELEASE" && c.projectId === (project || null)).map(c => ({id:c.id,title:c.title})),selected?.releaseId ?? "",kind === "QA_RUN") : null}
 {kind === "ROADMAP" ? <>{enumeration("horizon","Horizon",["NOW","NEXT","LATER"],"NEXT")}{text("quarter","Quarter (for example 2026-Q4)")}{select("ideaId","Linked idea",data.ideas)}{text("outcome","Intended outcome",{area:true})}</> : null}
 {kind === "RELEASE" ? <><label className="block text-label">GitHub repository (optional)<select className={control} name="repoId" value={repo} onChange={e=>setRepo(e.target.value)}><option value="">No repository link</option>{data.repos.filter(r=>!r.linkedProjectId||r.linkedProjectId===project).map(r=><option key={r.id} value={r.id}>{r.fullName}</option>)}</select></label>{select("githubEventId","Linked GitHub event",data.githubEvents.filter(e=>e.repoId===repo).map(e=>({id:e.id,title:e.title})))}{text("version","Version",{required:true})}{text("scope","Scope summary",{area:true})}{multi("taskIds","Scope tasks",data.tasks.filter(t => t.projectId === project).map(t => ({id:t.id,title:`${t.number} · ${t.title} · ${human(t.column?.category ?? "TODO")}`})))}{multi("roadmapIds","Scope roadmap items",data.choices.filter(c => c.kind === "ROADMAP" && c.projectId === (project || null)).map(c => ({id:c.id,title:c.title})))}{text("releaseNotes","Changelog notes",{area:true})}<p className="text-caption text-ink-muted">Complete scope, checklist and QA runs before requesting approval. Ship release can publish these notes internally.</p></> : null}
 {kind === "ISSUE" ? <>{enumeration("type","Issue type",["BUG","FEATURE_REQUEST","QA_CHECK"],"BUG")}{enumeration("severity","Severity",["LOW","MEDIUM","HIGH","CRITICAL"],"MEDIUM")}{text("steps","Steps to reproduce",{area:true})}{text("expected","Expected result",{area:true})}{text("environment","Environment")}{select("ideaId","Linked feature idea",data.ideas)}</> : null}
 {kind === "QA_RUN" ? <>{text("environment","Environment")}{text("findings","Findings",{area:true})}</> : null}
 {["QA_RUN","RELEASE"].includes(kind) ? <fieldset className="min-w-0 space-y-3"><legend className="text-h3">{kind === "QA_RUN" ? "QA checklist" : "Release checklist"}</legend>{checks.map((check,index) => <div key={index} className="space-y-2 rounded-lg border border-line p-3"><label className="block text-label">Check {index+1}<input className={control} required maxLength={200} value={check.title} onChange={e => setChecks(checks.map((c,i) => i===index ? {...c,title:e.target.value}:c))}/></label><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={check.done} onChange={e => setChecks(checks.map((c,i) => i===index ? {...c,done:e.target.checked}:c))}/>Passed / complete</label><label className="block text-label">Evidence or note<input className={control} maxLength={1000} value={check.note} onChange={e => setChecks(checks.map((c,i) => i===index ? {...c,note:e.target.value}:c))}/></label><Button type="button" variant="quiet" onClick={() => setChecks(checks.filter((_,i) => i!==index))}>Remove check {index+1}</Button></div>)}<Button type="button" variant="secondary" disabled={checks.length>=100} onClick={() => setChecks([...checks,{title:"",done:false,note:""}])}>Add check</Button></fieldset> : null}
 {kind === "PROTOTYPE" ? <>{text("version","Prototype version",{required:true})}{text("designRevision","Design revision notes",{area:true})}</> : null}
 {kind === "TEST" ? <>{select("parentId","Prototype",data.choices.filter(c => c.kind === "PROTOTYPE" && c.projectId === (project || null)).map(c => ({id:c.id,title:c.title})),selected?.parentId ?? "",true)}{text("testPlan","Test plan",{area:true,required:true})}{text("results","Results",{area:true})}{text("findings","Findings",{area:true})}{text("designRevision","Design revision notes",{area:true})}</> : null}
 {kind === "CHANGE" ? <>{text("environment","Where / environment",{required:true})}{text("changed","What changed",{area:true,required:true})}{enumeration("risk","Risk",["LOW","MEDIUM","HIGH"],"LOW")}{text("rollback","Rollback note",{area:true,required:true})}{select("incidentId","Linked incident",data.incidents.map(i => ({id:i.id,title:`${i.number} · ${i.title}`})))}<label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="requiresApproval" defaultChecked={Boolean(details.requiresApproval)} />Request approval (always required for high risk)</label></> : null}
 {kind === "ESTIMATE" ? <><label className="block text-label">Currency<input className={control} name="currency" required pattern="[A-Z]{3}" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())}/></label>{select("fundingId","Funding application",data.funding.filter(f => f.currency === currency).map(f => ({id:f.id,title:f.title})),selected?.fundingId ?? "")}{select("budgetId","Budget",data.budgets.filter(b => b.currency === currency).map(b => ({id:b.id,title:b.name})),selected?.budgetId ?? "")}{select("fundId","Finance fund",data.funds.filter(f => f.currency === currency).map(f => ({id:f.id,title:f.name})),selected?.fundId ?? "")}
 <CostEditor initial={detailSchemas.ESTIMATE.safeParse(details).success ? details.lines as EstimateLine[] : []} currency={currency} initialContingency={Number(details.contingencyBps ?? 1000)/100} quotes={selected?.attachments.filter(a => !a.generated).map(a => a.file) ?? []}/>{text("revisionNote","Reason for this estimate revision",{required:true,value:""})}</> : null}
 {text("notes","Notes",{area:true,value:selected?.notes ?? ""})}
 <Button type="submit" disabled={pending || data.selectedLocked}>{pending ? "Saving…" : "Save record"}</Button>
 </fieldset>
 {data.selectedLocked ? <p className="text-ink-muted">This record is locked while reviewed or after completion. Review its saved details and attachments here.</p> : null}
 <p id={`${uid}-message`} role="status" aria-live="polite" className="text-danger-fg">{message}</p>
 </form>;
}
export function OwnershipForm({ slug, data }: {slug:string;data:ProductData}) {
 const [pending,start] = useTransition(), [message,setMessage] = useState(""); const router = useRouter();
 return <form className="space-y-4 rounded-xl border border-line bg-panel p-4" onSubmit={e => { e.preventDefault();const form=new FormData(e.currentTarget);start(async () => {try {const result=await saveProductOwnership(slug,Object.fromEntries(form));setMessage(result.ok ? "Ownership updated." : result.error);if(result.ok)router.refresh();}catch{setMessage("Couldn't save ownership. Try again.");}}); }}><h2 className="text-h2">Set technical ownership</h2><fieldset disabled={pending} className="space-y-3"><legend className="sr-only">Service and owners</legend><label className="block text-label">System, repo or service<select name="serviceId" className={control} required><option value="">Choose a catalogue item</option>{data.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{["ownerId","backupOwnerId"].map(field => <label key={field} className="block text-label">{field==="ownerId"?"Owner":"Backup owner"}<select className={control} name={field} required><option value="">Choose a team member</option>{data.people.map(p => <option key={p.user.id} value={p.user.id}>{p.user.name ?? "Member"}</option>)}</select></label>)}<Button type="submit" disabled={pending}>{pending?"Saving…":"Save ownership"}</Button></fieldset><p role="status">{message}</p></form>;
}
