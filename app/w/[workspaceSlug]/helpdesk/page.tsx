import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { listTickets } from "@/lib/opsGaps/helpdesk";
import { admin } from "@/lib/opsGaps/context";
import { pageNumber } from "@/lib/opsGaps/rules";
import { formatDayTime } from "@/lib/format/datetime";
import { Frame, Empty, Pager, RecordRow, options, type ListParams } from "@/components/ops-gaps/Shared";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/display";
export default async function HelpdeskPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: ListParams }) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  const s = await searchParams; const page = pageNumber(s.page); const q = typeof s.q === "string" ? s.q.slice(0,160) : ""; const status = typeof s.status === "string" ? s.status : "";
  const data = await listTickets(actor, q, status, page); const base = `/w/${workspaceSlug}/helpdesk`;
  return <Frame title="Help desk" description={admin(actor) ? "Triage internal IT, account and operations requests for your team." : "Ask the operating team for help and follow your requests here."} action={{ href: `${base}/new`, label: "New request" }}>
    <Link className="inline-flex min-h-11 items-center text-accent-text underline" href={`/w/${workspaceSlug}/escalation`}>Who do I call?</Link>
    <a className="inline-flex min-h-11 items-center text-accent-text underline" href={`/w/${workspaceSlug}/people-tools/export/helpdesk`}>Export requests CSV</a><form className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field label="Search requests"><Input name="q" defaultValue={q} maxLength={160} /></Field><Field label="Status"><Dropdown name="status" defaultValue={status}><option value="">All statuses</option>{options(["OPEN","IN_PROGRESS","WAITING","RESOLVED","CLOSED"]).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Dropdown></Field><Button type="submit">Apply filters</Button></form>
    {data.rows.length ? <Card><ul>{data.rows.map(r => <RecordRow key={r.id} href={`${base}/${r.id}`} title={`#${r.number} · ${r.title}`} status={r.status}><span>{r.category}</span><span>{r.priority.toLowerCase()} priority</span><span>Target {formatDayTime(r.slaDueAt, actor.workspace.timezone)}</span>{!["RESOLVED","CLOSED"].includes(r.status) && r.slaDueAt < new Date() ? <Chip tone="warning">Overdue</Chip> : null}</RecordRow>)}</ul></Card> : <Empty patch line={q || status ? "No requests match these filters." : "No internal requests yet."} href={q || status ? base : `${base}/new`} action={q || status ? "Clear filters" : "New request"} />}
    <Pager base={base} page={page} total={data.total} query={{ q, status }} />
  </Frame>;
}
