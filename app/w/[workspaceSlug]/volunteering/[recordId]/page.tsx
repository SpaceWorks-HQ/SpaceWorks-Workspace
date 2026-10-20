import { listAttachments } from "@/lib/opsGaps/attachments";
import { Attachments } from "@/components/ops-gaps/Attachments";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getHours } from "@/lib/opsGaps/volunteering";
import { admin, names } from "@/lib/opsGaps/context";
import { durationLabel } from "@/lib/opsGaps/rules";
import { formatDayTime } from "@/lib/format/datetime";
import { decideVolunteerHours, cancelVolunteerHours } from "@/app/actions/opsGaps";
import { OpsForm, ChoiceField, LongField } from "@/components/ops-gaps/Form";
import { Frame, Panel, Prose, Status, options } from "@/components/ops-gaps/Shared";
import { DetailList } from "@/components/ui/display";
export default async function HoursDetailPage({ params }: { params: Promise<{ workspaceSlug: string; recordId: string }> }) {
  const { workspaceSlug,recordId } = await params; const actor = await requireWorkspace(workspaceSlug,"MEMBER"); const r = await getHours(actor,recordId); if (!r) notFound(); const n = await names(actor,[r.userId,r.reviewedById]);
  const files = await listAttachments(actor,"hours",r.id);
  return <Frame title={r.activity} back={{ href: `/w/${workspaceSlug}/volunteering`, label: "Hours" }}><Panel title="Hours log"><div className="mb-4"><Status value={r.status} /></div><DetailList items={[{ label: "Person", value: n[r.userId] ?? "Former member" },{ label: "Started", value: formatDayTime(r.startsAt,actor.workspace.timezone) },{ label: "Finished", value: formatDayTime(r.endsAt,actor.workspace.timezone) },{ label: "Break", value: `${r.breakMinutes} min` },{ label: "Contribution", value: durationLabel(r.minutes) },...(r.reviewedAt ? [{ label: "Reviewed", value: `${n[r.reviewedById ?? ""] ?? "Former member"} · ${formatDayTime(r.reviewedAt,actor.workspace.timezone)}` }] : [])]} />{r.reviewNote ? <div className="mt-5"><Prose>{r.reviewNote}</Prose></div> : null}</Panel>{r.status === "PENDING" && r.userId === actor.user.id ? <Panel title="Correct this log"><p className="mb-4 text-ink-secondary">Withdraw it, then submit the corrected hours as a new log.</p><OpsForm action={cancelVolunteerHours.bind(null,workspaceSlug)} submit="Withdraw pending log" hidden={{ id: r.id }} secondary /></Panel> : null}{r.status === "PENDING" && admin(actor) && r.userId !== actor.user.id ? <Panel title="Review hours"><OpsForm action={decideVolunteerHours.bind(null,workspaceSlug)} submit="Save review" hidden={{ id: r.id }}><ChoiceField name="decision" label="Decision" options={options(["APPROVED","REJECTED"])} /><LongField name="reviewNote" label="Review note" maxLength={2000} /></OpsForm></Panel> : null}<Attachments slug={workspaceSlug} kind="hours" recordId={r.id} files={files}/></Frame>;
}
