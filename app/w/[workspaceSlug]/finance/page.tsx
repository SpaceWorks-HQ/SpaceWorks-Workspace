import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canViewFinance, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Finance" };

/** Placeholder: replaced by the finance build. */
export default async function FinancePage({ params }: PageProps<"/w/[workspaceSlug]/finance">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(membership, workspace)) notFound();
  return <ComingSoon title="Finance" description="The kitty: income, expenses and invoices." />;
}
