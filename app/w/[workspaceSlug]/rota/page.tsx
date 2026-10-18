import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canUseRota, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Rota" };

/** Placeholder: replaced by the people-relationships build (see docs/ROADMAP-BUILD.md). */
export default async function RotaPage({ params }: PageProps<"/w/[workspaceSlug]/rota">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canUseRota(membership)) notFound();
  return <ComingSoon title="Rota" description="Open-hours and event shifts: sign up, swap and see who's covering." />;
}
