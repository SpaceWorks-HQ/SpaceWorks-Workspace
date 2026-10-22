import Link from "next/link";
import { BoardroomNewSession } from "@/components/boardroom/BoardroomNewSession";
import { Callout, Card, EmptyState, PageHeader } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format/datetime";
import { canContribute, isSuperAdminEmail, requireWorkspace } from "@/lib/permissions";
import { getAssistantSettings } from "@/lib/instanceSettings";
import { BoardroomStatusChip } from "@/components/boardroom/BoardroomStatusChip";

export const metadata = { title: "Boardroom" };

export default async function BoardroomPage({ params }: PageProps<"/w/[workspaceSlug]/boardroom">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  const [sessions, settings] = await Promise.all([
    prisma.boardroomSession.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, status: true, rounds: true, createdAt: true, createdBy: { select: { name: true } }, _count: { select: { seats: true } } },
    }),
    getAssistantSettings(),
  ]);
  const configured = Boolean(settings.apiKey);
  const now = new Date();
  const superAdmin = isSuperAdminEmail(user.email);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Boardroom" description="Put a question to a panel of AI advisors with different perspectives. They debate in rounds, then a moderator writes the recommendation and the dissent." />
      {!configured ? (
        <Callout tone="warning" title="The assistant isn't set up yet.">
          {superAdmin ? <>Add an Anthropic API key in <Link className="font-semibold underline" href="/admin/settings">instance settings</Link> to convene the panel.</> : "Ask your instance admin to add an AI key in instance settings."}
        </Callout>
      ) : canContribute(membership) ? (
        <BoardroomNewSession slug={workspace.slug} />
      ) : null}
      <section aria-labelledby="boardroom-history" className="flex flex-col gap-3">
        <h2 id="boardroom-history" className="text-h4 text-ink">Past sessions</h2>
        {sessions.length === 0 ? (
          <EmptyState patch title="No sessions yet.">Ask the panel about the next big purchase, a new house rule or a workshop plan.</EmptyState>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-line">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link href={`/w/${workspace.slug}/boardroom/${session.id}`} className="flex flex-col gap-1 px-5 py-4 transition-colors hover:bg-subtle sm:flex-row sm:items-center sm:gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-ink">{session.title}</span>
                      <span className="block text-caption text-ink-muted">
                        {session._count.seats} seats · {session.rounds} {session.rounds === 1 ? "round" : "rounds"} · {session.createdBy?.name ?? "Former member"} · {formatRelativeTime(session.createdAt, workspace.timezone, now)}
                      </span>
                    </span>
                    <BoardroomStatusChip status={session.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

