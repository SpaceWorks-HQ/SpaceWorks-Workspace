// Generated from app/w/[workspaceSlug]/volunteering/[recordId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listAttachments } from "@/lib/opsGaps/attachments";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getHours } from "@/lib/opsGaps/volunteering";
import { names } from "@/lib/opsGaps/context";

export async function loadHoursDetailPage({ params }: { params: Promise<{ workspaceSlug: string; recordId: string }> }) {
const { workspaceSlug,recordId } = await params;
const actor = await requireWorkspace(workspaceSlug,"MEMBER");
const r = await getHours(actor,recordId);
if (!r) notFound();
const n = await names(actor,[r.userId,r.reviewedById]);
const files = await listAttachments(actor,"hours",r.id);
return viewDto({ actor, r, n, files } as const);
}
