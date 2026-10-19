import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { listForms, submissions } from "@/lib/forms/service";
import { fieldsSchema } from "@/lib/forms/schema";
import { isAdmin } from "@/lib/approvals/context";
import { Intake } from "@/components/forms/Intake";
import { OpsForm } from "@/components/requests/OpsForm";
import { OpsLayout } from "@/components/requests/OpsLayout";
import { Card } from "@/components/ui/display";
import { sendInternalResponse, responseToTask } from "@/app/actions/forms";
import { formatDayTime } from "@/lib/format/datetime";
export default async function FormPage({params}:PageProps<"/w/[workspaceSlug]/forms/[id]">){
 const {workspaceSlug,id}=await params;const a=await requireWorkspace(workspaceSlug,"MEMBER");const f=(await listForms(a)).find(f=>f.id===id);if(!f)notFound();const fields=fieldsSchema.safeParse(f.fields);if(!fields.success)notFound();const inbox=isAdmin(a)?await submissions(a,id):null;
 return <OpsLayout slug={workspaceSlug} title={f.title} description={f.description??"Share a response with the team."}><Card>{f.closesAt&&f.closesAt<=new Date()?<p>This form is closed.</p>:<Intake fields={fields.data} action={sendInternalResponse.bind(null,workspaceSlug)} formId={f.id} />}</Card>{inbox&&<section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-h3">Responses</h2><a href={`/w/${workspaceSlug}/forms/${id}/export`} className="inline-flex min-h-11 items-center text-accent-text underline">Export CSV</a></div>{!inbox.rows.length&&<p className="text-body-ui text-ink-muted">No responses yet. Share the form with the crew.</p>}{inbox.rows.map(r=><Card key={r.id}><p className="mb-3 text-caption text-ink-muted">{formatDayTime(r.createdAt,a.workspace.timezone)}</p><dl className="space-y-3">{fields.data.map(f=><div key={f.key}><dt className="text-label">{f.label}</dt><dd className="whitespace-pre-wrap break-words text-body-ui">{String((r.answers as Record<string,unknown>)[f.key]??"—")}</dd></div>)}</dl>{r.linkedId?<p className="mt-4 text-body-ui">Converted to a task in My tasks.</p>:<div className="mt-4"><OpsForm action={responseToTask.bind(null,workspaceSlug)} hidden={{submissionId:r.id}} label="Create task" fields={[{name:"title",label:"Task title",required:true,helper:"Response details stay in this inbox. Give the task a safe, useful title."}]} /></div>}</Card>)}</section>}</OpsLayout>;
}
