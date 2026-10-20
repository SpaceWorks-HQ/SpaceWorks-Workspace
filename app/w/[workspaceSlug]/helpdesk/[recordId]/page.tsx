import { listAttachments } from "@/lib/opsGaps/attachments";
import { Attachments } from "@/components/ops-gaps/Attachments";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { pageNumber } from "@/lib/opsGaps/rules";
import { getTicket } from "@/lib/opsGaps/helpdesk";
import { admin, members, names } from "@/lib/opsGaps/context";
import { formatDayTime } from "@/lib/format/datetime";
import { replyHelpTicket, saveHelpTicket } from "@/app/actions/opsGaps";
import { OpsForm, ChoiceField, LongField, TextField } from "@/components/ops-gaps/Form";
import { Frame, Panel, Prose, Status, options, Pager, type ListParams } from "@/components/ops-gaps/Shared";
import { DetailList, Chip } from "@/components/ui/display";
export default async function HelpTicketPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; recordId: string }>; searchParams: ListParams }) {
  const { workspaceSlug, recordId } = await params; const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  const page = pageNumber((await searchParams).page);
  const r = await getTicket(actor, recordId, undefined, page); if (!r) notFound();
  const files = await listAttachments(actor,"ticket",r.id);
  const admins = admin(actor) ? (await members(actor)).filter(m => ["ADMIN","OWNER"].includes(m.role) && (!r.confidential || r.handlerIds.includes(m.userId))) : [];
  const n = await names(actor, [r.requesterId, r.assigneeId, ...r.comments.map(c => c.authorId)]);
  return <Frame title={`#${r.number} · ${r.title}`} back={{ href: `/w/${workspaceSlug}/helpdesk`, label: "Help desk" }}><Panel title="Request"><div className="mb-4"><Status value={r.status} /></div><DetailList items={[{ label: "Requested by", value: n[r.requesterId] ?? "Former member" },{ label: "Category", value: r.category },{ label: "Priority", value: r.priority.toLowerCase() },{ label: "Assignee", value: r.assigneeId ? n[r.assigneeId] ?? "Former member" : "Unassigned" },{ label: "Resolution target", value: formatDayTime(r.slaDueAt,actor.workspace.timezone) }]} /><div className="mt-5"><Prose>{r.description}</Prose></div></Panel>
    {admin(actor) ? <Panel title="Triage"><OpsForm key={r.updatedAt.toISOString()} action={saveHelpTicket.bind(null,workspaceSlug)} submit="Save triage" hidden={{ id: r.id, expectedUpdatedAt: r.updatedAt.toISOString() }}><ChoiceField name="status" label="Status" defaultValue={r.status} options={options(["OPEN","IN_PROGRESS","WAITING","RESOLVED","CLOSED"])} /><TextField name="dueAt" label="Due date" type="datetime-local" required={false} helper={`Use ${actor.workspace.timezone}. Leave empty to keep the current target.`}/><ChoiceField name="priority" label="Priority" defaultValue={r.priority} options={options(["LOW","NORMAL","HIGH","URGENT"])} /><ChoiceField name="assigneeId" label="Assignee" defaultValue={r.assigneeId ?? ""} required={false} options={[{ value: "", label: "Unassigned" },...admins.map(m => ({ value: m.userId, label: m.user.name ?? "Member" }))]} /></OpsForm></Panel> : null}
    <Panel title="Conversation"><ol className="space-y-5">{r.comments.map(c => <li key={c.id} className="border-b border-line pb-4"><div className="mb-2 flex flex-wrap gap-2 text-sm text-ink-muted"><span>{n[c.authorId] ?? "Former member"} · {formatDayTime(c.createdAt,actor.workspace.timezone)}</span>{c.internal ? <Chip>Admins only</Chip> : null}</div><Prose>{c.body}</Prose></li>)}</ol><Pager base={`/w/${workspaceSlug}/helpdesk/${r.id}`} page={page} total={r.commentCount} size={50} />{!r.comments.length ? <p className="mb-4 text-ink-muted">No replies yet.</p> : null}{r.status !== "CLOSED" ? <OpsForm action={replyHelpTicket.bind(null,workspaceSlug)} submit="Send reply" hidden={{ id: r.id }}><LongField name="body" label="Reply" />{admin(actor) ? <label className="flex min-h-11 items-center gap-3 text-ink"><input type="checkbox" name="internal" className="size-5 accent-primary" />Internal note for admins</label> : null}</OpsForm> : <p className="text-ink-muted">This request is closed. An admin can reopen it.</p>}</Panel>
  <Attachments slug={workspaceSlug} kind="ticket" recordId={r.id} files={files} /></Frame>;
}
