// Generated from app/w/[workspaceSlug]/chat/[channelSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { resolveChannel } from "@/lib/chat/access";
import { loadConversation } from "@/lib/chat/page";

export async function loadChannelPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/chat/[channelSlug]">) {
const { workspaceSlug, channelSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const resolved = await resolveChannel(ctx, { slug: decodeURIComponent(channelSlug) });
if (!resolved) notFound();
const data = await loadConversation(ctx, resolved, await searchParams);
const key = `${data.info.id}:${data.highlightId ?? ""}:${data.threadId ?? ""}`;
return viewDto({ data, key } as const);
}
