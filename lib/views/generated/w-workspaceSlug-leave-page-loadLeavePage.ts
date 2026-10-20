// Generated from app/w/[workspaceSlug]/leave/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { leaveData } from "@/lib/opsGaps/leave";
import { timeOffRequests, countTimeOffRequests } from "@/lib/people/timeOff";
import { members, names } from "@/lib/opsGaps/context";
import { listAttachments } from "@/lib/opsGaps/attachments";
import { localDay, pageNumber } from "@/lib/opsGaps/rules";

export async function loadLeavePage({params,searchParams}:{params:Promise<{workspaceSlug:string}>;searchParams:Promise<{year?:string;status?:string;page?:string}>}) {
const {workspaceSlug}=await params;
const actor=await requireWorkspace(workspaceSlug,"MEMBER");
const q=await searchParams;
const year=/^(20|21)\d\d$/.test(q.year??"")?Number(q.year):Number(localDay(new Date(),actor.workspace.timezone).slice(0,4));
const page=pageNumber(q.page);
const status=q.status??"";
const [data,requests,people,total]=await Promise.all([leaveData(actor,year),timeOffRequests(actor,{page,status,year:String(year)}),members(actor),countTimeOffRequests(actor,status,String(year))]);
const n=await names(actor,[...requests.map(r=>r.userId),...data.balances.map(b=>b.userId)]);
const files=await Promise.all(requests.map(r=>listAttachments(actor,"leave",r.id)));
const base=`/w/${workspaceSlug}`;
return viewDto({ actor, year, page, status, data, requests, people, total, n, files, base } as const);
}
