// Generated from app/w/[workspaceSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getDashboardData } from "@/lib/dashboard";
import { requireWorkspace } from "@/lib/permissions";

export async function loadWorkspaceHome({
  params,
}: PageProps<"/w/[workspaceSlug]">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug);
const d = await getDashboardData(workspace, user.id, membership);
const base = `/w/${workspace.slug}`;
const tz = workspace.timezone;
const upcoming = [
    ...d.meetings.map((m) => ({
      ...m,
      href: `${base}/meetings/${m.id}`,
      kind: "Meeting",
    })),
    ...d.shifts.map((s) => ({
      id: s.id,
      title: s.shiftType.name,
      startsAt: s.startsAt,
      href: `${base}/rota`,
      kind: "Shift",
    })),
  ]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 8);
return viewDto({ user, workspace, membership, d, base, tz, upcoming } as const);
}
