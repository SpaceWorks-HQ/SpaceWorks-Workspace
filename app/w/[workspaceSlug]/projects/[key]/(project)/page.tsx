import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectBoard } from "@/components/tasks/ProjectBoard";
import { requireWorkspace } from "@/lib/permissions";
import { findProjectByKey, getBoardData } from "@/lib/tasks/queries";

export async function generateMetadata({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]">): Promise<Metadata> {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const project = await findProjectByKey(context, key);
  return { title: project ? `${project.name} board` : "Project" };
}

export default async function ProjectBoardPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const board = await getBoardData(context, key);
  if (!board) notFound();
  return <ProjectBoard slug={context.workspace.slug} initial={board} viewerId={context.user.id} timeZone={context.workspace.timezone} />;
}
