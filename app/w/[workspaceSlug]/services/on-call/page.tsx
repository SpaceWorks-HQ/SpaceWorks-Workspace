import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices, canViewCosts } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/display";
import { ServicesNav } from "@/components/services/Display";
import { CommandForm } from "@/components/services/CommandForm";

import { currentOnCall } from "@/lib/monitor/onCall";
export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/services/on-call">) {
 const { workspaceSlug } = await params;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER"); if (!canViewServices(membership)) notFound();
 const [schedules, members, policies] = await Promise.all([prisma.onCallSchedule.findMany({ where: { workspaceId: workspace.id } }), prisma.membership.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true, user: { select: { name: true } } } }), prisma.escalationPolicy.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } })]);
 const manage = canManageServices(membership);
 return <div className="space-y-6"><h1 className="text-h1">On call</h1><ServicesNav slug={workspaceSlug} manage={manage} costs={canViewCosts(membership, workspace)} />{schedules.map(s => <Card key={s.id}><h2 className="text-h3">{s.name}</h2><p className="mt-3">On call now: {members.find(m => m.userId === currentOnCall(s, new Date()))?.user.name ?? "No active participant"}</p><p className="text-caption text-ink-muted">{s.rotation.toLowerCase()} handoff at {s.handoffTime} ({s.timezone})</p></Card>)}{manage ? <Card><h2 className="mb-3 text-h3">Add a rotation</h2><CommandForm slug={workspaceSlug} command="onCall" fixed={{ timezone: workspace.timezone }} label="Create rotation" fields={[{ name: "name", label: "Schedule name", required: true }, { name: "rotation", label: "Rotation", kind: "select", options: [{ value: "WEEKLY", label: "Weekly" }, { value: "DAILY", label: "Daily" }] }, { name: "handoffTime", label: "Handoff time", value: "09:00" }, { name: "participants", label: "Participants (shown order)", kind: "ids", options: members.map(m => ({ value: m.userId, label: m.user.name ?? "Member" })) }]} /></Card> : null}<Card><h2 className="text-h3">Escalation policies</h2>{policies.map(p => <p key={p.id} className="py-2">{p.name}</p>)}<p className="mt-3 text-body-ui text-ink-muted">Automatic incidents use the monitor’s Send to destinations and reminders. Acknowledging stops reminders and escalation.</p></Card></div>;
}
