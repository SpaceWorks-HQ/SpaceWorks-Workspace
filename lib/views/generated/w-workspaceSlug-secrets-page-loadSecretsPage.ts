// Generated from app/w/[workspaceSlug]/secrets/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { loadSecrets } from "@/lib/secrets/queries";

export async function loadSecretsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/secrets">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const q = await searchParams;
const change =
    typeof q.change === "string"
      ? await prisma.secretChange.findFirst({
          where: { workspaceId: actor.workspace.id, id: q.change },
          select: {
            id: true,
            status: true,
            diff: true,
            revision: true,
            createdAt: true,
            createdById: true,
            environmentId: true,
            environment: { select: { projectId: true } },
          },
        })
      : null;
const view = await loadSecrets(
    actor,
    change?.environment.projectId ??
      (typeof q.project === "string" ? q.project : undefined),
    change?.environmentId ??
      (typeof q.environment === "string" ? q.environment : undefined),
    typeof q.path === "string" ? q.path : "/",
    typeof q.snapshotCursor === "string" ? q.snapshotCursor : undefined,
    typeof q.keysCursor === "string" ? q.keysCursor : undefined,
  );
if (change && view.environment?.id === change.environmentId) {
    view.changes = [
      {
        id: change.id,
        status: change.status,
        diff: change.diff,
        revision: change.revision,
        createdAt: change.createdAt,
        createdById: change.createdById,
      },
      ...view.changes.filter((row) => row.id !== change.id),
    ];
  }
const initialSection =
    (change && view.environment?.id === change.environmentId) ||
    q.section === "history"
      ? ("History" as const)
      : ("Keys" as const);
const timezone = actor.workspace.timezone;
return viewDto({ view, initialSection, timezone } as const);
}
