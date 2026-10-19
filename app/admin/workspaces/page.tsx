import { CreateWorkspaceForm } from "@/components/admin/CreateWorkspaceForm";
import { WorkspaceArchiveButton } from "@/components/admin/AdminRowActions";
import { Chip, PageHeader } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { formatDate, viewerTimeZone } from "@/lib/format/datetime";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Workspaces" };

export default async function AdminWorkspacesPage() {
  await requireSuperAdminMfa();
  const workspaces = await prisma.workspace.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, name: true, slug: true, createdAt: true, archivedAt: true, _count: { select: { memberships: true } } },
  });
  const tz = viewerTimeZone();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Workspaces" description="Names and member counts only; workspace content stays private to members." />
      <CreateWorkspaceForm />
      <Table label="Workspaces">
        <THead>
          <tr><TH>Workspace</TH><TH>Members</TH><TH>Created</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr>
        </THead>
        <TBody>
          {workspaces.map((workspace) => (
            <TR key={workspace.id}>
              <TD><span className="block font-semibold">{workspace.name}</span><span className="block text-caption text-ink-muted">/w/{workspace.slug}</span></TD>
              <TD className="tabular-nums">{workspace._count.memberships}</TD>
              <TD className="whitespace-nowrap text-ink-muted">{formatDate(workspace.createdAt, tz)}</TD>
              <TD>{workspace.archivedAt ? <Chip tone="neutral" size="sm">Archived</Chip> : <Chip tone="success" size="sm">Active</Chip>}</TD>
              <TD className="text-right"><WorkspaceArchiveButton workspaceId={workspace.id} archived={Boolean(workspace.archivedAt)} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
