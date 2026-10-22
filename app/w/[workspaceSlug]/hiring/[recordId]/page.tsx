import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getCandidate,hiringData } from "@/lib/opsGaps/hiring";
import { listAttachments } from "@/lib/opsGaps/attachments";
import { members,names } from "@/lib/opsGaps/context";
import { CANDIDATE_STAGES } from "@/lib/opsGaps/rules";
import { saveHiringCandidate,newHiringInterview,startCandidateOnboarding } from "@/app/actions/opsGaps";
import { OpsForm,TextField,LongField,ChoiceField } from "@/components/ops-gaps/Form";
import { Frame,Panel,Status,Prose,options } from "@/components/ops-gaps/Shared";
import { Attachments } from "@/components/ops-gaps/Attachments";
export default async function CandidatePage({params}:{params:Promise<{workspaceSlug:string;recordId:string}>}){
 const {workspaceSlug,recordId}=await params;const actor=await requireWorkspace(workspaceSlug,"ADMIN");const r=await getCandidate(actor,recordId);if(!r)notFound();
 const [people,data,files]=await Promise.all([members(actor),hiringData(actor),listAttachments(actor,"candidate",recordId)]);const n=await names(actor,r.interviews.map(i=>i.interviewerId));
 const admins=people.filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
 return <Frame title={r.name} description={r.opening.title} back={{href:`/w/${workspaceSlug}/hiring`,label:"Hiring"}}><Status value={r.stage}/>
 <Panel title="Candidate details"><OpsForm key={r.updatedAt.toISOString()} action={saveHiringCandidate.bind(null,workspaceSlug)} submit="Save candidate" hidden={{id:r.id,expectedUpdatedAt:r.updatedAt.toISOString()}}><TextField name="name" label="Name" defaultValue={r.name}/><TextField name="email" label="Email" type="email" defaultValue={r.email} maxLength={254}/><TextField name="phone" label="Phone" type="tel" required={false} defaultValue={r.phone} maxLength={80}/><TextField name="source" label="Source" required={false} defaultValue={r.source}/><ChoiceField name="ownerId" label="Owner" options={admins} defaultValue={r.ownerId}/><ChoiceField name="stage" label="Stage" options={options(CANDIDATE_STAGES)} defaultValue={r.stage}/><TextField name="dueOn" label="Next follow-up" type="date" required={false} defaultValue={r.dueOn?.toISOString().slice(0,10)}/><LongField name="notes" label="Notes" required={false} maxLength={2000} defaultValue={r.notes}/><LongField name="offer" label="Offer details" required={false} maxLength={2000} defaultValue={r.offer}/><LongField name="decision" label="Decision and reason" required={false} maxLength={2000} defaultValue={r.decision}/></OpsForm></Panel>
 <Attachments slug={workspaceSlug} kind="candidate" recordId={r.id} files={files}/>
 <Panel title="Interview notes"><ul className="mb-5 space-y-4">{r.interviews.map(i=><li key={i.id} className="border-b border-line pb-3"><p className="font-semibold">{n[i.interviewerId]??"Former member"} · {i.heldOn.toISOString().slice(0,10)}</p><Prose>{i.note}</Prose></li>)}</ul><OpsForm action={newHiringInterview.bind(null,workspaceSlug)} submit="Add your interview notes" hidden={{id:r.id}}><TextField name="heldOn" label="Interview date" type="date"/><LongField name="note" label="Your notes"/></OpsForm></Panel>
 {r.onboardingRunId?<Panel title="Onboarding"><Link className="inline-flex min-h-11 items-center text-accent-text underline" href={`/w/${workspaceSlug}/onboarding`}>Open onboarding checklists</Link></Panel>:r.stage==="HIRED"?<Panel title="Start onboarding"><p className="mb-4 text-ink-secondary">Invite the candidate through workspace settings first. Choose the account with the candidate’s email and an existing onboarding template.</p><OpsForm action={startCandidateOnboarding.bind(null,workspaceSlug)} submit="Start onboarding" hidden={{id:r.id}}><ChoiceField name="userId" label="Candidate account" options={people.map(m=>({value:m.userId,label:m.user.name??"Member"}))}/><ChoiceField name="templateId" label="Onboarding template" options={data.templates.map(t=>({value:t.id,label:t.name}))}/></OpsForm></Panel>:null}
 </Frame>;
}
