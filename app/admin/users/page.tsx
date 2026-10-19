import { UserDisableButton } from "@/components/admin/AdminRowActions";
import { Chip, PageHeader } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { formatDate, formatRelativeTime, viewerTimeZone } from "@/lib/format/datetime";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Users" };

export default async function AdminUsersPage() {
  const session = await requireSuperAdminMfa();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, name: true, email: true, createdAt: true, lastSeenAt: true, disabledAt: true, mfaEnabledAt: true, _count: { select: { memberships: true } } },
  });
  const tz = viewerTimeZone();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Users" description="Disabling an account signs it out everywhere and blocks sign-in on every workspace." />
      <Table label="Users">
        <THead>
          <tr><TH>Person</TH><TH>Workspaces</TH><TH>Two-step</TH><TH>Last seen</TH><TH>Joined</TH><TH>Status</TH><TH><span className="sr-only">Actions</span></TH></tr>
        </THead>
        <TBody>
          {users.map((user) => (
            <TR key={user.id}>
              <TD><span className="block font-semibold">{user.name ?? "No name"}</span><span className="block text-caption text-ink-muted">{user.email}</span></TD>
              <TD className="tabular-nums">{user._count.memberships}</TD>
              <TD>{user.mfaEnabledAt ? <Chip tone="success" size="sm">On</Chip> : <Chip tone="neutral" size="sm">Off</Chip>}</TD>
              <TD className="whitespace-nowrap text-ink-muted">{user.lastSeenAt ? formatRelativeTime(user.lastSeenAt, tz) : "Never"}</TD>
              <TD className="whitespace-nowrap text-ink-muted">{formatDate(user.createdAt, tz)}</TD>
              <TD>{user.disabledAt ? <Chip tone="warning" size="sm">Disabled</Chip> : <Chip tone="success" size="sm">Active</Chip>}</TD>
              <TD className="text-right"><UserDisableButton userId={user.id} disabled={Boolean(user.disabledAt)} self={user.id === session.user.id} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
