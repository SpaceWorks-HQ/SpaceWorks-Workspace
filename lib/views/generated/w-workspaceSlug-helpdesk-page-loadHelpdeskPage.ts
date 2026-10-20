// Generated from app/w/[workspaceSlug]/helpdesk/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listTickets } from "@/lib/opsGaps/helpdesk";
import { pageNumber } from "@/lib/opsGaps/rules";
import { type ListParams } from "@/components/ops-gaps/Shared";

export async function loadHelpdeskPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: ListParams }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const s = await searchParams;
const page = pageNumber(s.page);
const q = typeof s.q === "string" ? s.q.slice(0,160) : "";
const status = typeof s.status === "string" ? s.status : "";
const data = await listTickets(actor, q, status, page);
const base = `/w/${workspaceSlug}/helpdesk`;
return viewDto({ actor, page, q, status, data, base } as const);
}
