import { members } from "@/lib/opsGaps/context";
import { randomUUID } from "node:crypto";
import { requireWorkspace } from "@/lib/permissions";
import { CATEGORIES } from "@/lib/opsGaps/rules";
import { newHelpTicket } from "@/app/actions/opsGaps";
import { OpsForm, TextField, LongField, ChoiceField } from "@/components/ops-gaps/Form";
import { Frame, Panel, options } from "@/components/ops-gaps/Shared";
export default async function NewHelpTicketPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params; const actor = await requireWorkspace(workspaceSlug, "MEMBER"); const handlers = (await members(actor)).filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
  return <Frame title="New internal request" description="Requests are visible to you and admins. Confidential requests are shared only with you and the designated handler. Keep passwords and credentials in the vault." back={{ href: `/w/${workspaceSlug}/helpdesk`, label: "Help desk" }}><Panel title="What do you need help with?"><OpsForm action={newHelpTicket.bind(null,workspaceSlug)} submit="Submit request" hidden={{ requestKey: randomUUID() }}><TextField name="title" label="Title" /><LongField name="description" label="Details" /><ChoiceField name="category" label="Category" options={CATEGORIES.map(value => ({ value, label: value }))} /><ChoiceField name="handlerId" label="Designated handler for confidential requests" required={false} options={[{value:"",label:"Choose for confidential requests"},...handlers]}/><ChoiceField name="priority" label="Priority" defaultValue="NORMAL" options={options(["LOW","NORMAL","HIGH","URGENT"])} /><p className="text-sm text-ink-muted">Resolution targets use elapsed hours: urgent 4 h, high 24 h, normal 72 h and low 7 days. For emergencies, contact the responsible person directly.</p></OpsForm></Panel></Frame>;
}
