import { LabelsManager } from "@/components/settings/LabelsManager";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Labels" };

export default async function LabelsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/labels">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const labels = await prisma.label.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, tone: true, _count: { select: { tasks: true } } },
  });
  return <LabelsManager slug={workspace.slug} labels={labels.map((label) => ({ id: label.id, name: label.name, tone: label.tone, taskCount: label._count.tasks }))} />;
}
