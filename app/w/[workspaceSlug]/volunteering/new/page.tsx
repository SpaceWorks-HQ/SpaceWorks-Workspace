import { randomUUID } from "node:crypto";
import { requireWorkspace } from "@/lib/permissions";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { newVolunteerHours } from "@/app/actions/opsGaps";
import { OpsForm, TextField } from "@/components/ops-gaps/Form";
import { Frame, Panel } from "@/components/ops-gaps/Shared";
export default async function NewHoursPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params; const actor = await requireWorkspace(workspaceSlug,"MEMBER"); const max = zonedDatetimeLocalValue(new Date(),actor.workspace.timezone);
  return <Frame title="Log hours" description="Record completed work for the operating team. An admin other than you reviews it. Logs can cover up to 16 hours and cannot overlap." back={{ href: `/w/${workspaceSlug}/volunteering`, label: "Hours" }}><Panel title="Your contribution"><OpsForm action={newVolunteerHours.bind(null,workspaceSlug)} submit="Submit hours" hidden={{ requestKey: randomUUID() }}><TextField name="activity" label="Activity" /><TextField name="startsAt" label="Started" type="datetime-local" max={max} helper={`Time zone: ${actor.workspace.timezone}`} /><TextField name="endsAt" label="Finished" type="datetime-local" max={max} /><TextField name="breakMinutes" label="Break in minutes" type="number" defaultValue={0} min={0} max={959} /></OpsForm></Panel></Frame>;
}
