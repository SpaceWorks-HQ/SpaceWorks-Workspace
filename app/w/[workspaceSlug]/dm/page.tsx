import { DirectMessagesHome } from "@/components/chat/DirectMessagesHome";
import { requireWorkspace } from "@/lib/permissions";
import { getSidebar } from "@/lib/chat/queries";

export const metadata = { title: "Direct messages" };

/**
 * DM home: recent conversations and the crew. `?to=<userId>[,<userId>]`
 * opens "New message" with those people picked (links from member profiles).
 */
export default async function DmPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/dm">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const { to } = await searchParams;
  const startWith = (typeof to === "string" ? to.split(",") : [])
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== ctx.user.id)
    .slice(0, 7);
  const sidebar = await getSidebar(ctx);
  return <DirectMessagesHome recent={sidebar.dms} startWith={startWith} />;
}
