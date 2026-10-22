import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageCloudAccounts } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/display";
import { CloudAccountForm } from "@/components/services/CloudAccountForm";
import { CommandForm } from "@/components/services/CommandForm";
import { formatDayTime } from "@/lib/format/datetime";
export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/settings/cloud-accounts">) {
 const { workspaceSlug } = await params;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN"); if (!canManageCloudAccounts(membership)) notFound();
 const connections = await prisma.cloudConnection.findMany({ where: { workspaceId: workspace.id }, orderBy: { label: "asc" }, select: { id: true, provider: true, label: true, accountLabel: true, credentialsHint: true, config: true, lastSyncAt: true, lastError: true, _count: { select: { resources: true } } } });
 return <div className="space-y-6"><h2 className="text-h4">Cloud accounts</h2><p className="text-body-ui text-ink-muted">Connect read-only accounts to see resource health and costs.</p>{connections.map(c => <Card key={c.id}><h2 className="text-h3">{c.label}</h2><p className="mt-2 text-caption text-ink-muted">{c.provider} · {c.accountLabel} · {c._count.resources} resources · credentials ending {c.credentialsHint ?? "—"}</p><p className="mt-2 text-body-ui">{c.lastSyncAt ? `Synced ${formatDayTime(c.lastSyncAt, workspace.timezone)}` : "Waiting for the first sync"}</p>{c.lastError ? <p role="alert" className="mt-3 text-danger-fg">{c.lastError}</p> : null}<div className="mt-4 flex flex-wrap gap-4"><CommandForm slug={workspaceSlug} command="syncCloud" fixed={{ id: c.id }} label="Request sync" /><CommandForm slug={workspaceSlug} command="deleteCloud" fixed={{ id: c.id }} label="Disconnect account…" confirmText="Disconnect this account and remove its synced resources and costs?" /></div><details className="mt-4"><summary className="min-h-11 cursor-pointer text-label">Replace credentials</summary><CloudAccountForm slug={workspaceSlug} existing={{ id: c.id, provider: c.provider, label: c.label, config: c.config as Record<string, unknown> }} /></details></Card>)}<Card><h2 className="mb-4 text-h3">Connect a cloud account</h2><CloudAccountForm slug={workspaceSlug} /></Card></div>;
}
