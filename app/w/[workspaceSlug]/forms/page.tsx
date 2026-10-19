import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canContribute, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Forms" };

/** Placeholder: replaced by the ops-money build (see docs/ROADMAP-BUILD.md). */
export default async function FormsPage({ params }: PageProps<"/w/[workspaceSlug]/forms">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(membership)) notFound();
  return <ComingSoon title="Forms" description="Forms and request intake: equipment requests, event proposals, sign-ups." />;
}
