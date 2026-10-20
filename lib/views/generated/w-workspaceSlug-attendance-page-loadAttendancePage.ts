// Generated from app/w/[workspaceSlug]/attendance/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { attendanceData, attendancePeople, orgData } from "@/lib/orgPeople/service";
import { orgFiles } from "@/lib/orgPeople/files";
import { dayKey } from "@/lib/community/schedule";
import { monthDays } from "@/lib/orgPeople/rules";
import { canRecordAttendance } from "@/lib/roles";

export async function loadAttendancePage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ month?: string; userId?: string; teamId?: string; date?: string; editUserId?: string }> }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const q = await searchParams;
const today = dayKey(new Date(), actor.workspace.timezone);
const month = monthDays(q.month ?? "").length ? q.month! : today.slice(0, 7);
const [data, org, permittedPeople] = await Promise.all([attendanceData(actor, month, { userId: q.userId, teamId: q.teamId }), orgData(actor), attendancePeople(actor)]);
const editUserId = data.people.some(p => p.userId === q.editUserId) ? q.editUserId! : data.people.find(p => p.userId === q.userId)?.userId ?? data.people.find(p => p.userId === actor.user.id)?.userId ?? data.people[0]?.userId;
const date = data.days.includes(q.date ?? "") ? q.date! : month === today.slice(0, 7) ? today : data.days[0];
const cell = data.cells.find(c => c.userId === editUserId && c.date === date);
const target = data.people.find(p => p.userId === editUserId);
const writable = Boolean(target && canRecordAttendance(actor.membership, target.userId === actor.user.id, org.people.find(p => p.id === target.userId)?.managerId === actor.user.id, target.role));
const files = cell?.entry ? await orgFiles(actor, "attendance", [cell.entry.id]) : [];
const base = `/w/${workspaceSlug}`;
const query = new URLSearchParams({ month, ...(q.teamId ? { teamId: q.teamId } : {}), ...(q.userId ? { userId: q.userId } : {}) }).toString();
return viewDto({ month, data, org, permittedPeople, editUserId, date, cell, writable, files, base, query } as const);
}
