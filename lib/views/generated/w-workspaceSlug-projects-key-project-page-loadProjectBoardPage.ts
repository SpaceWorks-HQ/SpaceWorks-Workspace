// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getBoardData } from "@/lib/tasks/queries";

export async function loadProjectBoardPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const board = await getBoardData(context, key);
if (!board) notFound();
return viewDto({ context, board } as const);
}
