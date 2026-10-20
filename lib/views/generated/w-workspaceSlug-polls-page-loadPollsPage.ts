// Generated from app/w/[workspaceSlug]/polls/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { canReadPoll } from "@/lib/polls/service";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadPollsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/polls">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canContribute(actor.membership)) notFound();
const [rows, choices] = await Promise.all([
    prisma.poll.findMany({
      where: { workspaceId: actor.workspace.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    collaborationChoices(actor),
  ]);
const polls = (
    await Promise.all(
      rows.map(async (poll) =>
        (await canReadPoll(actor, poll)) ? poll : null,
      ),
    )
  ).filter((p) => p !== null);
return viewDto({ actor, choices, polls } as const);
}
