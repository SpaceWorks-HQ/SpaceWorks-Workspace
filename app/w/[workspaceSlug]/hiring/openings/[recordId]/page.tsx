import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { hiringData } from "@/lib/opsGaps/hiring";
import { members } from "@/lib/opsGaps/context";
import { ENGAGEMENT_TYPES } from "@/lib/opsGaps/rules";
import { saveHiringOpening } from "@/app/actions/opsGaps";
import { OpsForm,TextField,LongField,ChoiceField } from "@/components/ops-gaps/Form";
import { Frame,Panel,options } from "@/components/ops-gaps/Shared";
export default async function OpeningPage({params}:{params:Promise<{workspaceSlug:string;recordId:string}>}){
 const {workspaceSlug,recordId}=await params;const actor=await requireWorkspace(workspaceSlug,"ADMIN");const data=await hiringData(actor);const r=data.openings.find(o=>o.id===recordId);if(!r)notFound();const people=(await members(actor)).filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
 return <Frame title={r.title} back={{href:`/w/${workspaceSlug}/hiring`,label:"Hiring"}}><Panel title="Opening"><OpsForm action={saveHiringOpening.bind(null,workspaceSlug)} submit="Save opening" hidden={{id:r.id}}><TextField name="title" label="Title" defaultValue={r.title}/><LongField name="description" label="Description" defaultValue={r.description}/><ChoiceField name="engagementType" label="Engagement" options={options(ENGAGEMENT_TYPES)} defaultValue={r.engagementType}/><ChoiceField name="ownerId" label="Owner" options={people} defaultValue={r.ownerId}/><TextField name="dueOn" label="Closing date" type="date" required={false} defaultValue={r.dueOn?.toISOString().slice(0,10)}/><ChoiceField name="status" label="Status" options={options(["OPEN","PAUSED","CLOSED"])} defaultValue={r.status}/></OpsForm></Panel></Frame>;
}
