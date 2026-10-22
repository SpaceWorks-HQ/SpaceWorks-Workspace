// Generated from app/w/[workspaceSlug]/finance/receipt/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canManageFinance } from "@/lib/permissions";
import { financePickers } from "@/lib/finance/tools/queries";
import { getAssistantConfig } from "@/lib/assistant/client";

export async function loadPage({
  params,
}: PageProps<"/w/[workspaceSlug]/finance/receipt">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canManageFinance(actor.membership)) notFound();
const [pickers, config] = await Promise.all([
    financePickers(actor),
    getAssistantConfig(),
  ]);
return viewDto({ actor, pickers, config } as const);
}
