import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Announcements" };

/** Placeholder: replaced by the announcements build. */
export default async function AnnouncementsPage({ params }: PageProps<"/w/[workspaceSlug]/announcements">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Announcements" description="News and notices from the organisers." />;
}
