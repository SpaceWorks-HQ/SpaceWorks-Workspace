import Link from "next/link";
import { LiveRefresh } from "@/components/community/LiveRefresh";
import { RemoveShoutoutButton } from "@/components/community/RemoveShoutoutButton";
import { ShoutoutComposer } from "@/components/community/ShoutoutComposer";
import { ShoutoutFilters } from "@/components/community/ShoutoutFilters";
import { Avatar, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canGiveShoutouts } from "@/lib/community/access";
import { listShoutouts, shoutoutCountsByRecipient } from "@/lib/community/shoutouts";

export const metadata = { title: "Shoutouts" };

export default async function ShoutoutsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/shoutouts">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const query = await searchParams;
  const { workspace } = ctx;
  const tz = workspace.timezone;

  const memberships = await prisma.membership.findMany({
    where: { workspaceId: workspace.id, status: "ACTIVE" },
    select: { user: { select: { id: true, name: true, email: true, image: true } } },
  });
  const members = memberships
    .map(({ user }) => ({ id: user.id, name: user.name?.trim() || user.email.split("@")[0]!, image: user.image }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const memberIds = new Set(members.map((member) => member.id));

  const personParam = typeof query.person === "string" ? query.person : null;
  const personId = personParam && memberIds.has(personParam) ? personParam : null;
  const direction = query.dir === "given" ? "given" : "received";
  const person = members.find((member) => member.id === personId) ?? null;

  const [shoutouts, counts] = await Promise.all([listShoutouts(ctx, { personId, direction }), shoutoutCountsByRecipient(workspace.id)]);
  const leaders = members
    .map((member) => ({ ...member, count: counts.get(member.id) ?? 0 }))
    .filter((member) => member.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);
  const canGive = canGiveShoutouts(ctx.membership);
  const toParam = typeof query.to === "string" ? query.to : undefined;
  const base = `/w/${workspace.slug}/shoutouts`;

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh slug={workspace.slug} types={["community.shoutout.changed"]} />
      <PageHeader title="Shoutouts" description="Thank the people who made something happen." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="wall-heading" className="flex min-w-0 flex-col gap-4">
          <h2 id="wall-heading" className="sr-only">Wall of thanks</h2>
          <ShoutoutFilters slug={workspace.slug} members={members.map(({ id, name }) => ({ id, name }))} personId={personId} direction={direction} />
          {person ? (
            <p className="text-body-ui text-ink-secondary" aria-live="polite">
              {direction === "received" ? `${person.name} has received` : `${person.name} has given`}{" "}
              <span className="font-semibold tabular-nums text-ink">{shoutouts.length}</span> {shoutouts.length === 1 ? "shoutout" : "shoutouts"}
              {shoutouts.length >= 60 ? " (showing the latest 60)" : ""}.
            </p>
          ) : null}
          {shoutouts.length === 0 ? (
            <EmptyState title={person ? "Nothing here yet." : "No shoutouts yet."}>
              {canGive ? "Be the first to thank someone for their work." : "Thanks between members show up here."}
            </EmptyState>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {shoutouts.map((shoutout) => (
                <li key={shoutout.id}>
                  <Card as="article" className="flex h-full flex-col gap-3">
                    <p className="flex items-center gap-2 text-label text-ink">
                      <Avatar name={shoutout.to.name} src={shoutout.to.image} size="sm" tone="success" />
                      <span className="min-w-0">
                        <Link href={`${base}?person=${shoutout.to.id}`} className="font-semibold underline-offset-4 hover:underline">{shoutout.to.name ?? "A member"}</Link>
                        <span className="block text-caption text-ink-muted">
                          from{" "}
                          <Link href={`${base}?person=${shoutout.from.id}&dir=given`} className="underline-offset-4 hover:underline">{shoutout.from.name ?? "a member"}</Link> · {formatRelativeTime(shoutout.createdAt, tz)}
                        </span>
                      </span>
                    </p>
                    <p className="flex-1 whitespace-pre-line break-words text-body-ui text-ink-secondary">{shoutout.message}</p>
                    {shoutout.canDelete ? (
                      <div className="-mb-2 flex justify-end">
                        <RemoveShoutoutButton slug={workspace.slug} id={shoutout.id} recipient={shoutout.to.name ?? "this member"} />
                      </div>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="flex flex-col gap-6">
          {canGive ? <ShoutoutComposer slug={workspace.slug} members={members.filter((member) => member.id !== ctx.user.id).map(({ id, name }) => ({ id, name }))} defaultToId={toParam} /> : null}
          <Card>
            <CardHeader title="Most thanked" titleAs="h2" />
            {leaders.length === 0 ? (
              <p className="text-body-ui text-ink-muted">Nobody yet. Shoutouts add up here.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {leaders.map((member) => (
                  <li key={member.id}>
                    <Link href={`${base}?person=${member.id}`} className="flex min-h-11 items-center gap-3 py-1.5 hover:text-accent-text">
                      <Avatar name={member.name} src={member.image} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-body-ui text-ink">{member.name}</span>
                      <span className="text-label tabular-nums text-ink-secondary">{member.count}<span className="sr-only"> shoutouts</span></span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
