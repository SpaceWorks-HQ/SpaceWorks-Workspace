// Generated from app/w/[workspaceSlug]/safety/[recordId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listAttachments } from "@/lib/opsGaps/attachments";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getSafety } from "@/lib/opsGaps/safety";
import { admin, members, names } from "@/lib/opsGaps/context";

export async function loadSafetyReportPage({ params }: { params: Promise<{ workspaceSlug: string; recordId: string }> }) {
const { workspaceSlug, recordId } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const r = await getSafety(actor,recordId);
if (!r) notFound();
const files = await listAttachments(actor,"safety",r.id);
const admins = admin(actor) ? (await members(actor)).filter(m => ["ADMIN","OWNER"].includes(m.role)) : [];
const n = await names(actor,[r.reporterId,...r.actions.flatMap(a => [a.assigneeId,a.completedById])]);
return viewDto({ actor, r, files, admins, n } as const);
}
