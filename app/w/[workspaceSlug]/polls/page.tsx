import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { canReadPoll } from "@/lib/polls/service";
import {
  collaborationChoices,
  options,
  optionalChoice,
} from "@/lib/meetings/choices";
import { pollAction } from "@/app/actions/polls";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  EntryLink,
} from "@/components/meetings/Structure";
import { Chip, EmptyState } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
export const metadata = { title: "Polls" };
export default async function PollsPage({
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
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Polls"
      description="Ask the crew, agree who can vote, and decide when results become visible."
    >
      <Disclosure title="Start a poll" open={!polls.length}>
        <ActionForm
          slug={workspaceSlug}
          action={pollAction}
          hidden={{ op: "create" }}
          label="Open poll"
          primary
          navigateTo={`/w/${workspaceSlug}/polls/`}
          fields={[
            { name: "question", label: "Question", required: true },
            { name: "descriptionMd", label: "Context", type: "textarea" },
            {
              name: "type",
              label: "Voting method",
              type: "select",
              options: [
                { value: "SINGLE", label: "One choice" },
                { value: "MULTI", label: "Multiple choices" },
                { value: "RANKED", label: "Ranked choices" },
              ],
              required: true,
            },
            {
              name: "options",
              label: "Options, one per line",
              type: "lines",
              required: true,
              help: "Add between 2 and 30 different options.",
            },
            {
              name: "anonymous",
              label: "Keep votes anonymous",
              type: "checkbox",
            },
            {
              name: "resultsVisibility",
              label: "Show results",
              type: "select",
              options: [
                { value: "AFTER_CLOSE", label: "After the poll closes" },
                { value: "LIVE", label: "While voting is open" },
              ],
              required: true,
            },
            {
              name: "closesAt",
              label: "Closes at",
              type: "datetime-local",
              required: true,
              help: "Enter the time in your device's time zone.",
            },
            {
              name: "eligibility.type",
              label: "Who can vote",
              type: "select",
              options: [
                {
                  value: "ALL_MEMBERS",
                  label: "All members, admins and owners",
                },
                { value: "TEAM", label: "Members of a team" },
                { value: "ROLE", label: "A minimum role" },
              ],
            },
            {
              name: "eligibility.ref",
              label: "Team or minimum role",
              type: "select",
              options: [
                optionalChoice("Everyone"),
                ...options(["MEMBER", "ADMIN", "OWNER"]),
                ...choices.teams,
              ],
              help: "Choose a team or role when restricting eligibility.",
            },
            {
              name: "quorum.count",
              label: "Minimum number of voters",
              type: "number",
              min: 1,
              max: 100000,
              help: "Leave blank if no quorum is needed.",
            },
          ]}
        />
      </Disclosure>
      {!polls.length ? (
        <EmptyState title="No polls yet. Ask the crew a question above." />
      ) : (
        <ul className="space-y-3">
          {polls.map((p) => (
            <EntryLink
              key={p.id}
              href={`/w/${workspaceSlug}/polls/${p.id}`}
              title={p.question}
              meta={
                <>
                  <Chip>
                    {p.closedAt || (p.closesAt && p.closesAt <= new Date())
                      ? "Closed"
                      : "Open"}
                  </Chip>
                  {p.anonymous ? <Chip>Anonymous</Chip> : null}
                  <span>
                    {p.closesAt
                      ? `Closes ${formatDayTime(p.closesAt, actor.workspace.timezone)}`
                      : "No closing date"}
                  </span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </CollaborationShell>
  );
}
