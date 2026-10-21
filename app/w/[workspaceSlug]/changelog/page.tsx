import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { admin } from "@/lib/meetings/core";
import { changelogAction } from "@/app/actions/changelog";
import { listPickableDestinations } from "@/lib/notify/scopedRules";
import { formatDate } from "@/lib/format/datetime";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  Section,
  TextBody,
} from "@/components/meetings/Structure";
import { Chip, EmptyState } from "@/components/ui/display";
export const metadata = { title: "Changelog" };
export default async function ChangelogPage({
  params,
}: PageProps<"/w/[workspaceSlug]/changelog">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "GUEST");
  const manage = admin(actor);
  const [entries, destinations] = await Promise.all([
    prisma.changelogEntry.findMany({
      where: {
        workspaceId: actor.workspace.id,
        ...(manage ? {} : { publishedAt: { not: null } }),
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    manage
      ? listPickableDestinations(actor.workspace.id, actor.membership.role)
      : [],
  ]);
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Changelog"
      description="A shared record of what changed, when it shipped, and why it matters."
    >
      {manage ? (
        <Disclosure title="Write an entry" open={!entries.length}>
          <ActionForm
            slug={workspaceSlug}
            action={changelogAction}
            hidden={{ op: "create" }}
            label="Save draft"
            primary
            reset
            fields={[
              { name: "title", label: "Title", required: true },
              {
                name: "bodyMd",
                label: "What changed",
                type: "textarea",
                required: true,
              },
              { name: "version", label: "Version" },
              {
                name: "tags",
                label: "Tags",
                type: "tags",
                help: "Separate tags with commas.",
              },
              {
                name: "audience",
                label: "Audience",
                type: "select",
                options: [
                  { value: "INTERNAL", label: "Internal" },
                  {
                    value: "PUBLIC",
                    label: "Public",
                  },
                ],
              },
            ]}
          />
        </Disclosure>
      ) : null}
      {!entries.length ? (
        <EmptyState patch title="No changes published yet. The next release will appear here." />
      ) : (
        entries.map((entry) => (
          <Section key={entry.id} title={entry.title}>
            <div className="flex flex-wrap gap-2">
              <Chip>{entry.publishedAt ? "Published" : "Draft"}</Chip>
              {entry.version ? <Chip>{entry.version}</Chip> : null}
              {entry.tags.map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
            <p className="text-caption text-ink-muted">
              {formatDate(
                entry.publishedAt ?? entry.createdAt,
                actor.workspace.timezone,
              )}
            </p>
            <TextBody>{entry.bodyMd}</TextBody>
            {manage && !entry.publishedAt ? (
              <>
                <details>
                  <summary className="min-h-11 cursor-pointer text-accent-text">
                    Edit entry
                  </summary>
                  <ActionForm
                    slug={workspaceSlug}
                    action={changelogAction}
                    hidden={{ op: "edit", entryId: entry.id }}
                    label="Save draft"
                    fields={[
                      {
                        name: "title",
                        label: "Title",
                        value: entry.title,
                        required: true,
                      },
                      {
                        name: "bodyMd",
                        label: "What changed",
                        type: "textarea",
                        value: entry.bodyMd,
                        required: true,
                      },
                      {
                        name: "version",
                        label: "Version",
                        value: entry.version ?? "",
                      },
                      {
                        name: "tags",
                        label: "Tags",
                        type: "tags",
                        value: entry.tags.join(", "),
                      },
                    ]}
                  />
                </details>
                <details>
                  <summary className="min-h-11 cursor-pointer text-accent-text">
                    Publish and send to
                  </summary>
                  <ActionForm
                    slug={workspaceSlug}
                    action={changelogAction}
                    hidden={{ op: "publish", entryId: entry.id }}
                    label="Publish entry"
                    confirm="Publish this entry and send it to the selected destinations? Published entries remain as a record."
                    fields={[
                      {
                        name: "publishedAt",
                        label: "Release date",
                        type: "date",
                        value: new Date().toISOString().slice(0, 10),
                        required: true,
                      },
                      {
                        name: "destinationIds",
                        label: "Send to",
                        type: "multi",
                        options: destinations.map((d) => ({
                          value: d.id,
                          label: d.name,
                        })),
                      },
                    ]}
                  />
                </details>
              </>
            ) : null}
          </Section>
        ))
      )}
    </CollaborationShell>
  );
}
