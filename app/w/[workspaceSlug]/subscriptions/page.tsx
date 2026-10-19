import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canViewSubscriptions, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Subscriptions" };

/** Placeholder: replaced by the ops-money build (see docs/ROADMAP-BUILD.md). */
export default async function SubscriptionsPage({ params }: PageProps<"/w/[workspaceSlug]/subscriptions">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewSubscriptions(membership)) notFound();
  return <ComingSoon title="Subscriptions" description="Domains, hosting and SaaS plans, with renewal reminders before anything lapses." />;
}
