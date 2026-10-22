// Generated from app/w/[workspaceSlug]/safety/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listSafety } from "@/lib/opsGaps/safety";
import { pageNumber } from "@/lib/opsGaps/rules";
import { type ListParams } from "@/components/ops-gaps/Shared";

export async function loadSafetyPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: ListParams }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const s = await searchParams;
const page = pageNumber(s.page);
const status = typeof s.status === "string" ? s.status : "";
const data = await listSafety(actor,status,page);
const base = `/w/${workspaceSlug}/safety`;
return viewDto({ actor, page, status, data, base } as const);
}
