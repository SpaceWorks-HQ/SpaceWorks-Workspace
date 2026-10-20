// Generated from app/w/[workspaceSlug]/hiring/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { hiringData } from "@/lib/opsGaps/hiring";
import { members } from "@/lib/opsGaps/context";
import { pageNumber } from "@/lib/opsGaps/rules";
import { type ListParams } from "@/components/ops-gaps/Shared";

export async function loadHiringPage({params,searchParams}:{params:Promise<{workspaceSlug:string}>;searchParams:ListParams}) {
const {workspaceSlug}=await params;
const actor=await requireWorkspace(workspaceSlug,"ADMIN");
const q=await searchParams;
const page=pageNumber(q.page);
const data=await hiringData(actor,q.status??"",q.q??"",page);
const people=(await members(actor)).filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
const base=`/w/${workspaceSlug}/hiring`;
return viewDto({ page, data, people, base } as const);
}
