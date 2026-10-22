// Generated from app/w/[workspaceSlug]/volunteering/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listHours, monthlyHours } from "@/lib/opsGaps/volunteering";
import { names } from "@/lib/opsGaps/context";
import { pageNumber, localDay } from "@/lib/opsGaps/rules";
import { type ListParams } from "@/components/ops-gaps/Shared";

export async function loadHoursPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: ListParams }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug,"MEMBER");
const s = await searchParams;
const page = pageNumber(s.page);
const status = typeof s.status === "string" ? s.status : "";
const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(s.q??"")?s.q!:localDay(new Date(),actor.workspace.timezone).slice(0,7);
const monthly=await monthlyHours(actor,month);
const data = await listHours(actor,status,page);
const base = `/w/${workspaceSlug}/volunteering`;
const n = await names(actor,[...data.rows.map(r => r.userId),...monthly.map(r=>r.userId)]);
return viewDto({ actor, page, status, month, monthly, data, base, n } as const);
}
