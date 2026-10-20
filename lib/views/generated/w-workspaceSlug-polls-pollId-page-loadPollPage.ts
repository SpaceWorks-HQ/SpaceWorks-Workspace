// Generated from app/w/[workspaceSlug]/polls/[pollId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { pollView } from "@/lib/polls/service";

export async function loadPollPage({
  params,
}: PageProps<"/w/[workspaceSlug]/polls/[pollId]">) {
const { workspaceSlug, pollId } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canContribute(actor.membership)) notFound();
const poll = await pollView(actor, pollId);
if (!poll) notFound();
return viewDto({ actor, poll } as const);
}
