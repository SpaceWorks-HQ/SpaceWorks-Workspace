// Generated from app/w/[workspaceSlug]/templates/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { templateWhere } from "@/lib/templates/service";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadTemplatesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/templates">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canContribute(actor.membership)) notFound();
const [templates, choices] = await Promise.all([
    prisma.template.findMany({
      where: await templateWhere(actor),
      orderBy: { name: "asc" },
      take: 200,
    }),
    collaborationChoices(actor),
  ]);
return viewDto({ actor, templates, choices } as const);
}
