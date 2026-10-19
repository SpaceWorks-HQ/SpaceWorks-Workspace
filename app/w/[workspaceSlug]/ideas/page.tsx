import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { IDEA_LABELS } from "@/lib/ideas/merge";
import { ideaAction } from "@/app/actions/ideas";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  EntryLink,
} from "@/components/meetings/Structure";
import { Chip } from "@/components/ui/display";
export const metadata = { title: "Ideas" };
export default async function IdeasPage({
  params,
}: PageProps<"/w/[workspaceSlug]/ideas">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const ideas = await prisma.idea.findMany({
    where: {
      workspaceId: actor.workspace.id,
      OR: [{ convertedType: null }, { convertedType: { not: "idea" } }],
    },
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }],
    include: { _count: { select: { votes: true } } },
    take: 200,
  });
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Ideas"
      description="Share a possibility, help it take shape, and turn it into work."
    >
      <Disclosure title="Share an idea" open={!ideas.length}>
        <ActionForm
          slug={workspaceSlug}
          action={ideaAction}
          hidden={{ op: "create" }}
          label="Share idea"
          primary
          navigateTo={`/w/${workspaceSlug}/ideas/`}
          fields={[
            { name: "title", label: "Idea", required: true },
            {
              name: "bodyMd",
              label: "What could we build or improve",
              type: "textarea",
            },
            {
              name: "tags",
              label: "Tags",
              type: "tags",
              help: "Separate tags with commas.",
            },
          ]}
        />
      </Disclosure>
      <ul className="space-y-3">
        {ideas.map((idea) => (
          <EntryLink
            key={idea.id}
            href={`/w/${workspaceSlug}/ideas/${idea.id}`}
            title={idea.title}
            meta={
              <>
                <Chip>{IDEA_LABELS[idea.status]}</Chip>
                <span>
                  {idea._count.votes} upvotes
                  {idea.tags.length ? ` · ${idea.tags.join(", ")}` : ""}
                </span>
              </>
            }
          />
        ))}
      </ul>
    </CollaborationShell>
  );
}
