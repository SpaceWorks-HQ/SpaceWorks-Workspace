import { loadApprovalInbox } from "@/lib/views/components";
import { Suspense } from "react";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getApprovalView } from "@/lib/approvals/engine";
import { submitGenericRequest, addApprovalComment } from "@/app/actions/requests";
import { ApprovalInbox } from "@/components/requests/ApprovalInbox";
import { OpsForm } from "@/components/requests/OpsForm";
import { OpsLayout, Editor, words } from "@/components/requests/OpsLayout";
import { Card, Chip } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
export const metadata = { title: "Approvals" };
// Keep the guarded read in the page, inside the streamed section.
async function InboxSection({ workspaceSlug }: { workspaceSlug: string }) {
 const { rows } = await loadApprovalInbox({ params: { workspaceSlug } });
 return <ApprovalInbox workspaceSlug={workspaceSlug} rows={rows} />;
}

export default async function ApprovalsPage({ params }: PageProps<"/w/[workspaceSlug]/requests/approvals">) {
 const { workspaceSlug } = await params;
 const actor = await requireWorkspace(workspaceSlug, "MEMBER");
 const requests = await prisma.approvalRequest.findMany({ where: { workspaceId: actor.workspace.id, requesterId: actor.user.id, subjectType: { in: ["CUSTOM", "VAULT_ACCESS"] } }, orderBy: { createdAt: "desc" }, take: 100 });
 const views = new Map(await Promise.all(requests.map(async r => [r.id, await getApprovalView(actor, r.subjectType, r.subjectId)] as const)));
 return <OpsLayout slug={workspaceSlug} title="Approvals" description="Review requests and keep a record of each decision.">
  <Suspense fallback={<p role="status">Loading approvals</p>}><InboxSection workspaceSlug={workspaceSlug} /></Suspense>
  <Editor title="Request a decision"><OpsForm action={submitGenericRequest.bind(null, workspaceSlug)} label="Request approval" fields={[{name:"title",label:"What needs a decision?",required:true,helper:"Give reviewers enough context in one sentence. Keep credentials and personal details in the vault."}]} /></Editor>
  <section className="space-y-4"><h2 className="text-h3">Your approval requests</h2>{!requests.length && <p className="text-body-ui text-ink-muted">No requests yet. Request a decision above.</p>}
  {requests.map(r => {
   const view = views.get(r.id);
   return <Card key={r.id}><div className="flex flex-wrap justify-between gap-3"><h3 className="text-title">{r.title}</h3><Chip>{words(r.status)}</Chip></div>{view?.waitingOn.length ? <p className="mt-3 text-body-ui">Waiting on {view.waitingOn.join(", ")}</p> : r.status === "PENDING" ? <p className="mt-3 text-body-ui">Waiting for eligible approvers. Ask an admin to check the policy and membership.</p> : null}{view?.decisions.map((d,i) => <p key={i} className="mt-3 whitespace-pre-wrap break-words text-body-ui">{d.approverName} · {d.decision === "PENDING" ? "Comment" : words(d.decision)} · {formatDayTime(d.createdAt,actor.workspace.timezone)}{d.comment ? ` — ${d.comment}` : ""}</p>)}<div className="mt-4"><OpsForm action={addApprovalComment.bind(null,workspaceSlug)} hidden={{requestId:r.id}} label="Add comment" fields={[{name:"comment",label:"Comment",type:"textarea",required:true,helper:"Keep secrets out of comments."}]} /></div></Card>;
  })}</section>
 </OpsLayout>;
}
