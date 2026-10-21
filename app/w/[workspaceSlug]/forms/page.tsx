import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { listForms } from "@/lib/forms/service";
import { isAdmin } from "@/lib/approvals/context";
import { closeIntakeForm, newPublicFormLink } from "@/app/actions/forms";
import { fieldsSchema } from "@/lib/forms/schema";
import { FormBuilder } from "@/components/forms/FormBuilder";
import { OpsForm } from "@/components/requests/OpsForm";
import { OpsLayout, Editor, Empty } from "@/components/requests/OpsLayout";
import { Card, Chip } from "@/components/ui/display";
export const metadata={title:"Forms and intake"};
export default async function FormsPage({params}:PageProps<"/w/[workspaceSlug]/forms">){
 const {workspaceSlug}=await params;const a=await requireWorkspace(workspaceSlug,"MEMBER");if(!canContribute(a.membership))notFound();const forms=await listForms(a);
 return <OpsLayout slug={workspaceSlug} title="Forms and intake" description="Collect requests, review responses and turn the next step into a task.">{isAdmin(a)&&<Editor title="Build a form" open={!forms.length}><FormBuilder slug={workspaceSlug} /></Editor>}{!forms.length&&<Empty patch>No forms yet. Ask an admin to build the first intake form.</Empty>}{forms.map(f=><Card key={f.id}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-title"><Link className="text-accent-text underline" href={`/w/${workspaceSlug}/forms/${f.id}`}>{f.title}</Link></h2><Chip>{f.closesAt&&f.closesAt<=new Date()?"Closed":f.visibility==="PUBLIC_LINK"?"Public link":"Internal"}</Chip></div><p className="mt-2 text-body-ui text-ink-muted">{f.description}</p>{isAdmin(a)&&<div className="mt-4 space-y-4"><p className="text-body-ui">{f._count.submissions} responses</p><details><summary className="min-h-11 cursor-pointer text-label">Edit form settings and questions</summary><p className="mb-3 text-caption text-ink-muted">Questions stay fixed once responses arrive. Create a new form to ask different questions.</p><FormBuilder slug={workspaceSlug} initial={{id:f.id,title:f.title,description:f.description,visibility:f.visibility,closesAt:f.closesAt ? zonedDatetimeLocalValue(f.closesAt,a.workspace.timezone).slice(0,10) : "",maxResponses:f.maxResponses,fields:fieldsSchema.parse(f.fields)}} /></details>{f.visibility==="PUBLIC_LINK"&&<OpsForm action={newPublicFormLink.bind(null,workspaceSlug)} hidden={{formId:f.id}} label="Replace public link" confirm="Replace the public link? The previous link will stop working." />}<OpsForm action={closeIntakeForm.bind(null,workspaceSlug)} hidden={{formId:f.id}} label="Close form" confirm="Stop accepting responses to this form?" /></div>}</Card>)}</OpsLayout>;
}
