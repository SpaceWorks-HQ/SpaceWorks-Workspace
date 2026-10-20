import { randomUUID } from "node:crypto";
import { requireWorkspace } from "@/lib/permissions";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { newSafetyReport } from "@/app/actions/opsGaps";
import { OpsForm, TextField, LongField, ChoiceField } from "@/components/ops-gaps/Form";
import { Frame, Panel, options } from "@/components/ops-gaps/Shared";
export default async function NewSafetyPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params; const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  return <Frame title="Report an incident" description="Only you and workspace admins can open your report. Follow-up handling notes are restricted to admins. Record only the personal details needed for follow-up." back={{ href: `/w/${workspaceSlug}/safety`, label: "Safety reports" }}><Panel title="What happened?"><OpsForm action={newSafetyReport.bind(null,workspaceSlug)} submit="Submit confidential report" hidden={{ requestKey: randomUUID() }}><TextField name="title" label="Title" /><ChoiceField name="kind" label="Kind of report" options={options(["INJURY","NEAR_MISS","DAMAGE","HAZARD"])} /><TextField name="location" label="Location" /><TextField name="occurredAt" label="When it happened" type="datetime-local" defaultValue={zonedDatetimeLocalValue(new Date(),actor.workspace.timezone)} max={zonedDatetimeLocalValue(new Date(),actor.workspace.timezone)} helper={`Time zone: ${actor.workspace.timezone}`} /><LongField name="description" label="What happened and who needs help?" /><LongField name="immediateAction" label="Immediate action taken" required={false} maxLength={2000} /></OpsForm></Panel></Frame>;
}
