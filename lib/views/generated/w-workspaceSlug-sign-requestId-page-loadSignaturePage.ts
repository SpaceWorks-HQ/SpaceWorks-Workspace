// Generated from app/w/[workspaceSlug]/sign/[requestId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { signatureView } from "@/lib/signatures/service";

export async function loadSignaturePage({
  params,
}: PageProps<"/w/[workspaceSlug]/sign/[requestId]">) {
const { workspaceSlug, requestId } = await params;
const actor = await requireWorkspace(workspaceSlug, "GUEST");
const request = await signatureView(actor, requestId);
if (!request) notFound();
return viewDto({ actor, request } as const);
}
