import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canViewContacts, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Contacts" };

/** Placeholder: replaced by the people-relationships build (see docs/ROADMAP-BUILD.md). */
export default async function ContactsPage({ params }: PageProps<"/w/[workspaceSlug]/contacts">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewContacts(membership)) notFound();
  return <ComingSoon title="Contacts" description="Sponsors, partners, vendors and mentors, with the history of every conversation." />;
}
