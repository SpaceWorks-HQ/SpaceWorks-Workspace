import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { decisionWhere } from "@/lib/meetings/service";
import { formatDate } from "@/lib/format/datetime";
import {
  CollaborationShell,
  Section,
  TextBody,
} from "@/components/meetings/Structure";
import { FilterForm } from "@/components/meetings/FilterForm";
import { EmptyState } from "@/components/ui/display";
export const metadata = { title: "Decisions" };
export default async function DecisionsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/meetings/decisions">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "GUEST");
  const q = String((await searchParams).q ?? "").slice(0, 200);
  const decisions = await prisma.decision.findMany({
    where: {
      AND: [
        await decisionWhere(actor),
        q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { contextMd: { contains: q, mode: "insensitive" } },
                { decisionMd: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    },
    orderBy: { decidedAt: "desc" },
    take: 200,
    include: { meeting: { select: { title: true } } },
  });
  const owners = await prisma.membership.findMany({
    where: { workspaceId: actor.workspace.id, status: "ACTIVE" },
    select: { user: { select: { id: true, name: true } } },
  });
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Decisions"
      description="The context, outcome and owner of decisions across meetings."
    >
      <FilterForm label="Search decisions" name="q" value={q} button="Search" />
      {!decisions.length ? (
        <EmptyState patch
          title="No decisions found. Record one in a meeting."
          action={
            <a
              className="text-accent-text underline"
              href={`/w/${workspaceSlug}/meetings`}
            >
              Open meetings
            </a>
          }
        />
      ) : (
        decisions.map((d) => (
          <Section key={d.id} title={d.title}>
            <p className="text-caption text-ink-muted">
              {formatDate(d.decidedAt, actor.workspace.timezone)} ·{" "}
              {d.deciderIds
                .map(
                  (id) =>
                    owners.find((m) => m.user.id === id)?.user.name ??
                    "Former member",
                )
                .join(", ")}
            </p>
            <h3 className="text-label">Context</h3>
            <TextBody>{d.contextMd || "No context recorded."}</TextBody>
            <h3 className="text-label">Outcome</h3>
            <TextBody>{d.decisionMd}</TextBody>
            {d.meetingId ? (
              <a
                className="inline-flex min-h-11 items-center text-accent-text underline"
                href={`/w/${workspaceSlug}/meetings/${d.meetingId}`}
              >
                {d.meeting?.title ?? "Open meeting"}
              </a>
            ) : null}
          </Section>
        ))
      )}
    </CollaborationShell>
  );
}
