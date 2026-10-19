import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/display";
import { ServicesNav } from "@/components/services/Display";
import { CommandForm } from "@/components/services/CommandForm";

export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/services/settings">) {
 const { workspaceSlug } = await params;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN"); if (!canManageServices(membership)) notFound();
 const entries = await prisma.monitorNetworkAllowlist.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" } });
 return <div className="space-y-6"><h1 className="text-h1">Services settings</h1><ServicesNav slug={workspaceSlug} manage costs /><Card><CommandForm slug={workspaceSlug} command="settings" fields={[{ name: "membersCanAckIncidents", label: "Allow members to acknowledge incidents", kind: "checkbox", value: workspace.membersCanAckIncidents }, { name: "costsVisibleToMembers", label: "Allow members to view cloud costs", kind: "checkbox", value: workspace.costsVisibleToMembers }, { name: "monitorRetentionDays", label: "Keep raw checks (7–30 days)", kind: "number", value: workspace.monitorRetentionDays }]} /></Card><Card><h2 className="mb-4 text-h3">Private network targets</h2><p className="mb-4 text-body-ui text-ink-muted">The instance admin must enable MONITOR_ALLOW_PRIVATE_TARGETS before these entries take effect. Metadata addresses are always blocked.</p><ul>{entries.map(e => <li key={e.id} className="border-b border-line py-3"><p>{e.cidrOrHost} {e.note}</p><CommandForm slug={workspaceSlug} command="deleteAllowlist" fixed={{ id: e.id }} confirmText="Remove this network allowance?" label="Remove entry…" /></li>)}</ul><CommandForm slug={workspaceSlug} command="allowlist" label="Allow target" fields={[{ name: "cidrOrHost", label: "Host, IP or CIDR", required: true }, { name: "note", label: "Reason (Optional)" }]} /></Card><Link className="text-accent-text" href={`/w/${workspaceSlug}/settings/notifications`}>Notification destinations and rules</Link></div>;
}
