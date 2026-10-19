import type { Metadata } from "next";
import { AppShell } from "@/components/chrome/AppShell";
import { getShellData } from "@/lib/appShell";
import { touchLastSeen } from "@/lib/presence";
import { requireWorkspace } from "@/lib/permissions";

export async function generateMetadata({ params }: LayoutProps<"/w/[workspaceSlug]">): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug);
  return { title: { default: workspace.name, template: `%s · ${workspace.name}` } };
}

/**
 * Workspace shell. Membership is checked here for the chrome, and again by
 * every page (layouts do not re-run on client navigation).
 */
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug);
  const data = await getShellData(user, workspace, membership);
  await touchLastSeen(user.id);
  return <AppShell data={data}>{children}</AppShell>;
}
