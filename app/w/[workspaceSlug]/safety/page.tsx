import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { listSafety } from "@/lib/opsGaps/safety";
import { admin } from "@/lib/opsGaps/context";
import { pageNumber } from "@/lib/opsGaps/rules";
import { formatDayTime } from "@/lib/format/datetime";
import { Frame, Empty, Pager, RecordRow, options, type ListParams } from "@/components/ops-gaps/Shared";
import { Field, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, Callout } from "@/components/ui/display";
export default async function SafetyPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: ListParams }) {
  const { workspaceSlug } = await params; const actor = await requireWorkspace(workspaceSlug, "MEMBER"); const s = await searchParams; const page = pageNumber(s.page); const status = typeof s.status === "string" ? s.status : "";
  const data = await listSafety(actor,status,page); const base = `/w/${workspaceSlug}/safety`;
  return <Frame title="Safety reports" description={admin(actor) ? "Confidential reports and follow-ups for the operating team." : "Your confidential reports, shared with workspace admins."} action={{ href: `${base}/new`, label: "Report an incident" }}><nav className="flex flex-wrap gap-4"><a className="min-h-11 py-3 text-primary underline" href={`/w/${workspaceSlug}/people-tools/export/safety`}>Export reports CSV</a>{admin(actor)?<><Link className="min-h-11 py-3 text-primary underline" href={`${base}/inspections`}>Inspections</Link><Link className="min-h-11 py-3 text-primary underline" href={`${base}/facilities`}>Facilities and leases</Link></>:null}</nav><Callout tone="warning">For immediate danger, contact local emergency services and the responsible person. This inbox is not monitored continuously.</Callout><form className="flex flex-wrap items-end gap-3"><Field label="Status"><Dropdown name="status" defaultValue={status}><option value="">All statuses</option>{options(["REPORTED","INVESTIGATING","FOLLOW_UP","CLOSED"]).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Dropdown></Field><Button type="submit">Apply filter</Button></form>
    {data.rows.length ? <Card><ul>{data.rows.map(r => <RecordRow key={r.id} href={`${base}/${r.id}`} title={r.title} status={r.status}><span>{r.kind.toLowerCase().replaceAll("_"," ")}</span><span>{formatDayTime(r.occurredAt,actor.workspace.timezone)}</span></RecordRow>)}</ul></Card> : <Empty line={status ? "No reports match this filter." : "No safety reports yet."} href={status ? base : `${base}/new`} action={status ? "Clear filter" : "Report an incident"} />}<Pager base={base} page={page} total={data.total} query={{ status }} /></Frame>;
}
