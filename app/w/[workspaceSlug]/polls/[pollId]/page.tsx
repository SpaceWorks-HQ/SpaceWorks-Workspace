import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { pollView } from "@/lib/polls/service";
import { pollAction } from "@/app/actions/polls";
import { formatDayTime } from "@/lib/format/datetime";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Section,
  TextBody,
} from "@/components/meetings/Structure";
import { Chip } from "@/components/ui/display";
export const metadata = { title: "Poll" };
export default async function PollPage({
  params,
}: PageProps<"/w/[workspaceSlug]/polls/[pollId]">) {
  const { workspaceSlug, pollId } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const poll = await pollView(actor, pollId);
  if (!poll) notFound();
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title={poll.question}
      description={
        poll.closesAt
          ? `Closes ${formatDayTime(poll.closesAt, actor.workspace.timezone)} · ${actor.workspace.timezone}`
          : "Share your choice with the crew."
      }
    >
      <div className="flex flex-wrap gap-2">
        <Chip>{poll.closed ? "Closed" : "Open"}</Chip>
        <Chip>{poll.anonymous ? "Anonymous ballot" : "Named ballot"}</Chip>
        <Chip>
          {poll.resultsVisibility === "LIVE"
            ? "Live results"
            : "Results after close"}
        </Chip>
      </div>
      <TextBody>{poll.description}</TextBody>
      {!poll.closed && poll.canVote && !poll.hasVoted ? (
        <Section title="Your vote">
          <p className="text-body-ui text-ink-muted">
            Votes are final once recorded.
            {poll.anonymous
              ? " Your identity is stored separately to prevent a second vote. Individual ballots and voter lists are never displayed."
              : " Your identity is stored with your vote. Only aggregate results are displayed."}
          </p>
          <ActionForm
            slug={workspaceSlug}
            action={pollAction}
            hidden={{ op: "vote", pollId }}
            label="Record vote"
            primary
            confirm="Record this final vote? You cannot change it afterwards."
            fields={[
              {
                name: "choices",
                label:
                  poll.type === "RANKED"
                    ? "Rank the options"
                    : "Choose your options",
                type:
                  poll.type === "RANKED"
                    ? "ranked"
                    : poll.type === "MULTI"
                      ? "multi"
                      : "single",
                required: true,
                options: poll.options.map((o) => ({
                  value: o.id,
                  label: o.label,
                })),
              },
            ]}
          />
        </Section>
      ) : (
        <p role="status" className="text-ink-muted">
          {poll.hasVoted
            ? "Your vote has been recorded."
            : poll.closed
              ? "Voting has ended."
              : "You can manage this poll, but you are not eligible to vote."}
        </p>
      )}
      <Section title="Results">
        {poll.tally ? (
          <>
            <p>
              {poll.tally.ballots} ballots · {poll.eligibleCount} eligible
              members · {poll.tally.quorumMet ? "Quorum met" : "Quorum not met"}
            </p>
            <ul className="space-y-3">
              {poll.options.map((o) => (
                <li key={o.id}>
                  <div className="mb-1 flex justify-between gap-2">
                    <span>{o.label}</span>
                    <span>
                      {poll.tally!.counts[o.id]}
                      {poll.type === "RANKED" ? " first choices" : " votes"}
                    </span>
                  </div>
                  <progress
                    aria-label={`${o.label}: ${poll.tally!.counts[o.id]} votes`}
                    className="h-3 w-full accent-[var(--yy-primary)]"
                    max={Math.max(1, poll.tally!.ballots)}
                    value={poll.tally!.counts[o.id]}
                  />
                </li>
              ))}
            </ul>
            <p className="text-label">
              {poll.tally.winners.length > 1
                ? "Tied leaders"
                : "Leading choice"}
              :{" "}
              {poll.tally.winners
                .map((id) => poll.options.find((o) => o.id === id)?.label)
                .join(", ") || "No votes"}
            </p>
            {poll.type === "RANKED" ? (
              <ol className="space-y-2">
                {poll.tally.rounds.map((round, i) => (
                  <li key={i}>
                    Round {i + 1}:{" "}
                    {Object.entries(round)
                      .map(
                        ([id, count]) =>
                          `${poll.options.find((o) => o.id === id)?.label}: ${count}`,
                      )
                      .join("; ")}
                  </li>
                ))}
              </ol>
            ) : null}
            <p className="text-caption text-ink-muted">
              Multi-choice totals may exceed ballot count. Ranked ballots
              transfer to the next remaining choice; exhausted ballots do not
              count towards a round’s majority.
            </p>
          </>
        ) : (
          <p className="text-ink-muted">
            Results become visible when the poll closes.
          </p>
        )}
      </Section>
      {!poll.closed && poll.canClose ? (
        <ActionForm
          slug={workspaceSlug}
          action={pollAction}
          hidden={{ op: "close", pollId }}
          label="Close poll…"
          destructive
          confirm="Close voting now and reveal the final results?"
        />
      ) : null}
    </CollaborationShell>
  );
}
