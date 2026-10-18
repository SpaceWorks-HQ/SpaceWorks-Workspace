import { MembersTable } from "@/components/settings/MembersTable";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Members" };

export default async function MembersSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/members">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  const members = await prisma.membership.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    select: { id: true, role: true, status: true, title: true, joinedAt: true, user: { select: { id: true, name: true, email: true, image: true } } },
  });
  return (
    <MembersTable
      slug={workspace.slug}
      actorRole={membership.role}
      members={members.map((m) => ({
        membershipId: m.id,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: m.role,
        status: m.status,
        title: m.title,
        joined: formatDate(m.joinedAt, workspace.timezone),
        isSelf: m.user.id === user.id,
      }))}
    />
  );
}
