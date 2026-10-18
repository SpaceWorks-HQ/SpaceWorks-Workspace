import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canUseVault, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Vault" };

/** Placeholder: replaced by the ops-money build (see docs/ROADMAP-BUILD.md). */
export default async function VaultPage({ params }: PageProps<"/w/[workspaceSlug]/vault">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canUseVault(membership)) notFound();
  return <ComingSoon title="Vault" description="Shared logins and secrets, encrypted, with per-item access and a reveal log." />;
}
