import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canSubmitRequests, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Requests" };

/** Placeholder: replaced by the ops-money build (see docs/ROADMAP-BUILD.md). */
export default async function RequestsPage({ params }: PageProps<"/w/[workspaceSlug]/requests">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canSubmitRequests(membership)) notFound();
  return <ComingSoon title="Requests" description="Purchase requests, reimbursements and the approvals waiting on you." />;
}
