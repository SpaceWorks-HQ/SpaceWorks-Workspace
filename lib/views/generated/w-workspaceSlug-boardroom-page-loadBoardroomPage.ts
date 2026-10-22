// Generated from app/w/[workspaceSlug]/boardroom/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { isSuperAdminEmail, requireWorkspace } from "@/lib/permissions";
import { getAssistantSettings } from "@/lib/instanceSettings";

export async function loadBoardroomPage({ params }: PageProps<"/w/[workspaceSlug]/boardroom">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
const [sessions, settings] = await Promise.all([
    prisma.boardroomSession.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, status: true, rounds: true, createdAt: true, createdBy: { select: { name: true } }, _count: { select: { seats: true } } },
    }),
    getAssistantSettings(),
  ]);
const configured = Boolean(settings.apiKey);
const now = new Date();
const superAdmin = isSuperAdminEmail(user.email);
return viewDto({ workspace, membership, sessions, configured, now, superAdmin } as const);
}
