// Generated from app/w/[workspaceSlug]/dm/[channelId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { resolveChannel } from "@/lib/chat/access";
import { loadConversation } from "@/lib/chat/page";

export async function loadDirectMessagePage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/dm/[channelId]">) {
const { workspaceSlug, channelId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const resolved = await resolveChannel(ctx, { id: channelId });
if (!resolved || resolved.channel.kind !== "DIRECT") notFound();
const data = await loadConversation(ctx, resolved, await searchParams);
const key = `${data.info.id}:${data.highlightId ?? ""}:${data.threadId ?? ""}`;
return viewDto({ data, key } as const);
}
