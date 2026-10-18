import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/display";
import { canManageCloudAccounts, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Cloud accounts" };

/** Placeholder: replaced by the monitor build (see docs/ROADMAP-BUILD.md). */
export default async function CloudAccountsSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/cloud-accounts">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageCloudAccounts(membership)) notFound();
  return (
    <EmptyState mood="thinking" title="Coming in the next build.">
      Connect read-only DigitalOcean, AWS, Render, Cloudflare and Hetzner accounts for the Services monitor.
    </EmptyState>
  );
}
