import "server-only";
import type { OrgActor } from "./service";
import { attendanceData, orgData, responsibilities, escalationData } from "./service";
import { csvCell, STATUS_LABELS } from "./rules";
import { recordAuditEvent } from "@/lib/audit";
export async function orgExport(actor: OrgActor, kind: "attendance" | "responsibilities" | "organisation" | "escalation", filters: { month: string; userId?: string; teamId?: string }) {
  let rows: unknown[][];
  if (kind === "attendance") {
    const data = await attendanceData(actor, filters.month, filters);
    rows = [["Person ID", "Name", "Engagement", "Date", "Status", "Attendance days", "Source"], ...data.cells.map(c => [c.userId, c.name, c.engagementType, c.date, c.status ? STATUS_LABELS[c.status] : "Not recorded", c.status === "HALF_DAY" ? 0.5 : ["PRESENT", "REMOTE"].includes(c.status ?? "") ? 1 : 0, c.source])];
  } else if (kind === "organisation") {
    const data = await orgData(actor); const name = (id: string | null) => data.people.find(p => p.id === id)?.name ?? "Not assigned";
    rows = [["Department", "Parent department", "Head", "Person", "Reports to", "Engagement", "Notes"], ...data.departments.flatMap(d => {
      const members = data.people.filter(p => p.departmentId === d.id);
      return (members.length ? members : [null]).map(p => [d.name, data.departments.find(v => v.id === d.parentId)?.name ?? "", name(d.headId), p?.name ?? "", name(p?.managerId ?? null), p?.engagementType ?? "", d.notes]);
    }), ...data.people.filter(p => !p.departmentId).map(p => ["Not assigned", "", "", p.name, name(p.managerId), p.engagementType, ""])];
  } else if (kind === "escalation") {
    const data = await escalationData(actor);
    rows = [["Area", "Status", "Working hours", "Order", "Person", "Availability", "Phone", "Messaging", "Instructions", "Notes"], ...data.paths.flatMap(p => p.steps.map((s, i) => [p.title, p.active ? "Active" : "Paused", p.hoursNote, i + 1, data.people.find(v => v.id === s.userId)?.name ?? "Former member", s.hours, data.contacts.find(c => c.userId === s.userId)?.contactPhone ?? "", data.contacts.find(c => c.userId === s.userId)?.contactHandle ?? "", s.instruction, p.notes]))];
  } else {
    const [data, records] = await Promise.all([orgData(actor), responsibilities(actor)]);
    const names = (ids: string[]) => ids.map(id => data.people.find(p => p.id === id)?.name ?? "Former member").join("; ");
    rows = [["Area", "Status", "Responsible", "Accountable", "Consulted", "Informed", "Backup", "Review date", "Notes"], ...records.map(r => [r.title, r.status, names(r.responsibleIds), names([r.accountableId]), names(r.consultedIds), names(r.informedIds), names(r.backupId ? [r.backupId] : []), r.reviewOn.toISOString().slice(0, 10), r.notes])];
  }
  await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: `org_people.${kind}.exported` });
  return new Response("\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="space-works-${kind}${kind === "attendance" ? `-${filters.month}` : ""}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
