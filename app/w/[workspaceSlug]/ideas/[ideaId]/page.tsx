import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { admin, jsonObject } from "@/lib/meetings/core";
import { collaborationChoices, optionalChoice } from "@/lib/meetings/choices";
import { IDEA_LABELS } from "@/lib/ideas/merge";
import { formatDayTime } from "@/lib/format/datetime";
import { ideaAction } from "@/app/actions/ideas";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  Section,
  TextBody,
} from "@/components/meetings/Structure";
import { Chip } from "@/components/ui/display";
export const metadata = { title: "Idea" };
export default async function IdeaPage({
  params,
}: PageProps<"/w/[workspaceSlug]/ideas/[ideaId]">) {
  const { workspaceSlug, ideaId } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const idea = await prisma.idea.findFirst({
    where: { workspaceId: actor.workspace.id, id: ideaId },
    include: {
      _count: { select: { votes: true } },
      votes: { where: { userId: actor.user.id }, select: { userId: true } },
    },
  });
  if (!idea) notFound();
  const [choices, comments, alternatives, merged] = await Promise.all([
    collaborationChoices(actor),
    prisma.activityEvent.findMany({
      where: {
        workspaceId: actor.workspace.id,
        entityType: "idea_comment",
        entityId: idea.id,
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    prisma.idea.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: { not: ideaId },
        convertedId: null,
      },
      select: { id: true, title: true },
      take: 200,
    }),
    prisma.idea.findMany({
      where: {
        workspaceId: actor.workspace.id,
        convertedType: "idea",
        convertedId: idea.id,
      },
      select: { id: true, title: true },
    }),
  ]);
  const isMerged = idea.convertedType === "idea";
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title={idea.title}
      description={`${IDEA_LABELS[idea.status]} · ${idea._count.votes} upvotes`}
    >
      <div className="flex flex-wrap gap-2">
        <Chip>{IDEA_LABELS[idea.status]}</Chip>
        {idea.tags.map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>
      <TextBody>{idea.bodyMd}</TextBody>
      {!idea.convertedId &&
      (admin(actor) || idea.authorId === actor.user.id) ? (
        <Disclosure title="Edit idea">
          <ActionForm
            slug={workspaceSlug}
            action={ideaAction}
            hidden={{ op: "edit", ideaId }}
            label="Save idea"
            fields={[
              {
                name: "title",
                label: "Idea",
                value: idea.title,
                required: true,
              },
              {
                name: "bodyMd",
                label: "Details",
                type: "textarea",
                value: idea.bodyMd ?? "",
              },
              {
                name: "tags",
                label: "Tags",
                type: "tags",
                value: idea.tags.join(", "),
              },
            ]}
          />
        </Disclosure>
      ) : null}
      {isMerged ? (
        <Section title="Merged duplicate">
          <a
            className="inline-flex min-h-11 items-center text-accent-text underline"
            href={`/w/${workspaceSlug}/ideas/${idea.convertedId}`}
          >
            Continue on the merged idea
          </a>
        </Section>
      ) : (
        <ActionForm
          slug={workspaceSlug}
          action={ideaAction}
          hidden={{ op: "vote", ideaId }}
          label={idea.votes.length ? "Remove your upvote" : "Upvote idea"}
          primary
        />
      )}
      {idea.convertedId && !isMerged ? (
        <Section title="Converted to work">
          <p>
            This idea became a {idea.convertedType}. Find it in{" "}
            {idea.convertedType === "project"
              ? "Projects"
              : "My tasks or its project"}
            .
          </p>
          <a
            className="inline-flex min-h-11 items-center text-accent-text underline"
            href={`/w/${workspaceSlug}/${idea.convertedType === "project" ? "projects" : "my-tasks"}`}
          >
            Open work
          </a>
        </Section>
      ) : null}
      {merged.length ? (
        <Section title="Merged ideas">
          <ul>
            {merged.map((m) => (
              <li key={m.id}>
                <a
                  className="inline-flex min-h-11 items-center text-accent-text underline"
                  href={`/w/${workspaceSlug}/ideas/${m.id}`}
                >
                  {m.title} and its comments
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Conversation">
        {comments.length ? (
          comments.map((c) => (
            <article key={c.id} className="space-y-2 border-b border-line py-3">
              <p className="text-caption text-ink-muted">
                {choices.members.find((m) => m.value === c.actorId)?.label ??
                  "Former member"}{" "}
                · {formatDayTime(c.createdAt, actor.workspace.timezone)}
              </p>
              <TextBody>{String(jsonObject(c.data).body ?? "")}</TextBody>
            </article>
          ))
        ) : (
          <p className="text-ink-muted">
            No comments yet. Help shape this idea.
          </p>
        )}
        {!isMerged ? (
          <ActionForm
            slug={workspaceSlug}
            action={ideaAction}
            hidden={{ op: "comment", ideaId }}
            label="Add comment"
            reset
            fields={[
              {
                name: "body",
                label: "Comment",
                type: "textarea",
                required: true,
              },
            ]}
          />
        ) : null}
      </Section>
      {admin(actor) && !isMerged ? (
        <>
          <Disclosure title="Update idea status">
            <ActionForm
              slug={workspaceSlug}
              action={ideaAction}
              hidden={{ op: "status", ideaId }}
              label="Save status"
              fields={[
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: idea.status,
                  options: Object.entries(IDEA_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  ),
                },
              ]}
            />
          </Disclosure>
          {!idea.convertedId ? (
            <>
              <Disclosure title="Convert to a task">
                <ActionForm
                  slug={workspaceSlug}
                  action={ideaAction}
                  hidden={{ op: "convert", ideaId, type: "task" }}
                  label="Create task"
                  fields={[
                    {
                      name: "projectId",
                      label: "Project",
                      type: "select",
                      options: [
                        optionalChoice("No project"),
                        ...choices.projects.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ],
                    },
                  ]}
                />
              </Disclosure>
              <Disclosure title="Convert to a project">
                <ActionForm
                  slug={workspaceSlug}
                  action={ideaAction}
                  hidden={{ op: "convert", ideaId, type: "project" }}
                  label="Create project"
                  fields={[
                    {
                      name: "key",
                      label: "Project key",
                      required: true,
                      help: "Use 2–10 letters or numbers, starting with a letter.",
                    },
                  ]}
                />
              </Disclosure>
              {alternatives.length ? (
                <Disclosure title="Merge a duplicate…">
                  <ActionForm
                    slug={workspaceSlug}
                    action={ideaAction}
                    hidden={{ op: "merge", ideaId }}
                    label="Merge idea…"
                    destructive
                    navigateTo={`/w/${workspaceSlug}/ideas/`}
                    confirm="Merge this idea into the selected idea? Votes will combine without duplicates and the source remains available for its discussion."
                    fields={[
                      {
                        name: "targetId",
                        label: "Merge into",
                        type: "select",
                        required: true,
                        options: alternatives.map((i) => ({
                          value: i.id,
                          label: i.title,
                        })),
                      },
                    ]}
                  />
                </Disclosure>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </CollaborationShell>
  );
}
