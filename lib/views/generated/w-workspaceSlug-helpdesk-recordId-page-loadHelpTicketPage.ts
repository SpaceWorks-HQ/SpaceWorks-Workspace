// Generated from app/w/[workspaceSlug]/helpdesk/[recordId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listAttachments } from "@/lib/opsGaps/attachments";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { pageNumber } from "@/lib/opsGaps/rules";
import { getTicket } from "@/lib/opsGaps/helpdesk";
import { admin, members, names } from "@/lib/opsGaps/context";
import { type ListParams } from "@/components/ops-gaps/Shared";

export async function loadHelpTicketPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; recordId: string }>; searchParams: ListParams }) {
const { workspaceSlug, recordId } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const page = pageNumber((await searchParams).page);
const r = await getTicket(actor, recordId, undefined, page);
if (!r) notFound();
const files = await listAttachments(actor,"ticket",r.id);
const admins = admin(actor) ? (await members(actor)).filter(m => ["ADMIN","OWNER"].includes(m.role) && (!r.confidential || r.handlerIds.includes(m.userId))) : [];
const n = await names(actor, [r.requesterId, r.assigneeId, ...r.comments.map(c => c.authorId)]);
return viewDto({ actor, page, r, files, admins, n } as const);
}
