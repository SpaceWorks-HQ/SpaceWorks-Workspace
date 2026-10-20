"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { productOperation } from "@/app/actions/productOps";
import type { ProductData } from "@/lib/productOps/load";
export function Operations({ slug, data }: { slug: string; data: ProductData }) {
 const [pending,start] = useTransition(), [message,setMessage] = useState(""); const [confirm,setConfirm] = useState<{ op:string; label:string }|null>(null); const [publish,setPublish] = useState(false); const router = useRouter(); const row=data.selected;
 if(!row)return null;
 function run(op:string,version?:number) {start(async () => {try{const result=await productOperation(slug,{id:row!.id,op,publish,version});setMessage(result.ok?"Record updated.":result.error);router.refresh();}catch{setMessage("Couldn't update the record. Try again.");}});}
 return <section className="space-y-3" aria-label="Record actions"><div className="flex flex-wrap items-center gap-2">
 {row.archivedAt?<Button variant="secondary" disabled={pending} onClick={()=>run("restore")}>Restore record</Button>:<>
 {!data.selectedLocked?<Button variant="quiet" disabled={pending} onClick={()=>setConfirm({op:"archive",label:"Archive record"})}>Archive record</Button>:null}
 {["RELEASE","CHANGE"].includes(row.kind)&&!row.shippedAt?<>
 {!data.approval || ["REJECTED","CHANGES_REQUESTED","CANCELLED"].includes(data.approval.status)?<Button variant="secondary" disabled={pending} onClick={()=>run("requestApproval")}>Request approval</Button>:null}
 {data.approval&&["PENDING","CHANGES_REQUESTED"].includes(data.approval.status)&&data.approval.requesterId===data.actorId?<Button variant="secondary" disabled={pending} onClick={()=>setConfirm({op:"withdraw",label:"Withdraw approval"})}>Withdraw approval</Button>:null}
 {row.kind==="RELEASE"&&data.approval?.status==="APPROVED"?<>{data.admin?<label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={publish} onChange={e=>setPublish(e.target.checked)}/>Publish an internal changelog entry</label>:null}<Button disabled={pending} onClick={()=>setConfirm({op:"ship",label:"Ship release"})}>Ship release</Button></>:null}
 {row.kind==="CHANGE"&&(!data.approval||data.approval.status==="APPROVED")?<Button disabled={pending} onClick={()=>setConfirm({op:"apply",label:"Apply change"})}>Apply change</Button>:null}
 </>:null}
 {row.kind==="CHANGE"&&row.status==="APPLIED"?<Button variant="secondary" disabled={pending} onClick={()=>setConfirm({op:"rollback",label:"Record rollback"})}>Record rollback</Button>:null}
 </>}
 {row.changelogId?<a className="min-h-11 py-3 text-accent-text underline" href={`/w/${slug}/changelog`}>View changelog</a>:null}
 {data.approval?<a className="min-h-11 py-3 text-accent-text underline" href={`/w/${slug}/requests/approvals`}>Review approval ({data.approval.status.toLowerCase().replaceAll("_"," ")})</a>:null}
 </div>
 {row.kind==="ESTIMATE"?<div className="space-y-3"><h3 className="text-h3">Estimate history</h3><p className="text-caption text-ink-muted">Each revision keeps its quantities, prices and supporting quotes. Generated PDFs use the saved revision.</p><ul className="divide-y divide-line">{row.estimates.map(v=><li key={v.id} className="flex flex-wrap items-center gap-3 py-2"><span>Revision {v.version}</span><a className="min-h-11 py-3 text-accent-text underline" href={`/api/w/${slug}/product-ops/export?estimate=${row.id}&version=${v.version}`}>CSV<span className="sr-only"> revision {v.version}</span></a><Button variant="secondary" disabled={pending} onClick={()=>run("pdf",v.version)}>Save PDF<span className="sr-only"> revision {v.version}</span></Button></li>)}</ul></div>:null}
 <p role="status" aria-live="polite">{pending?"Updating…":message}</p>
 <ConfirmDialog open={Boolean(confirm)} title={confirm?.label??"Update record"} message={confirm?.op==="ship"?"Record this release as shipped. Its scope, checklist and QA records will remain locked.":"This updates the saved record and keeps an audit entry."} confirmLabel={confirm?.label??"Save changes"} onCancel={()=>setConfirm(null)} onConfirm={()=>{const op=confirm?.op;setConfirm(null);if(op)run(op);}}/>
 </section>;
}
