// Generated from app/w/[workspaceSlug]/sign/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { admin } from "@/lib/meetings/core";
import { collaborationChoices } from "@/lib/meetings/choices";
import { visibleDocsWhere } from "@/lib/docs/service";

export async function loadSignaturesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/sign">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "GUEST");
const [requests, choices] = await Promise.all([
    prisma.signatureRequest.findMany({
      where: {
        workspaceId: actor.workspace.id,
        ...(admin(actor)
          ? {}
          : {
              OR: [
                { signerUserId: actor.user.id },
                { createdById: actor.user.id },
              ],
            }),
        doc: {
          ...visibleDocsWhere(actor.workspace.id, actor.membership.role),
          archivedAt: null,
        },
      },
      select: {
        id: true,
        status: true,
        signerUserId: true,
        doc: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    collaborationChoices(actor),
  ]);
return viewDto({ actor, requests, choices } as const);
}
