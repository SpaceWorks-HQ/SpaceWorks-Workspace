import Link from "next/link";
import { PageHeader, Card, Chip } from "@/components/ui/display";
import { QueryFilters } from "@/components/saved-views/QueryFilters";
import { LinkEditor } from "@/components/saved-views/LinkEditor";
import { SavedViews } from "@/components/saved-views/SavedViews";
import { ActionButton } from "@/components/notification-center/ActionButton";
import { linkState } from "@/app/actions/links";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { searchActor } from "@/lib/shell/context";
import { listLinks } from "@/lib/shell/links";
import { listSavedViews } from "@/lib/shell/views";
export const metadata = { title: "Links" };
export default async function LinksPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/links">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.slice(0, 200) : "";
  const tag = typeof query.tag === "string" ? query.tag.slice(0, 40) : "";
  const [links, bookmarks, views] = await Promise.all([
    listLinks(searchActor(ctx), tag, q),
    prisma.bookmark.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        entityType: "link",
      },
      select: { entityId: true },
    }),
    listSavedViews(searchActor(ctx), "link"),
  ]);
  const base = `/w/${workspaceSlug}/links`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Links"
        description="Useful places the crew keeps close to hand. Pin a link to find it in your sidebar."
      />
      <QueryFilters q={q} tag={tag} links />
      {canContribute(ctx.membership) ? (
        <LinkEditor slug={workspaceSlug} />
      ) : null}
      <SavedViews
        slug={workspaceSlug}
        userId={ctx.user.id}
        entityType="link"
        filters={{ q, tag }}
        views={views}
        base={base}
      />
      {links.length ? (
        <ul className="grid min-w-0 gap-4 sm:grid-cols-2">
          {links.map((l) => {
            const pin = bookmarks.some((b) => b.entityId === l.id);
            const edit =
              canContribute(ctx.membership) &&
              (l.createdById === ctx.user.id ||
                hasRoleAtLeast(ctx.membership.role, "ADMIN"));
            return (
              <li key={l.id} id={l.id} className="min-w-0">
                <Card className="h-full">
                  <a
                    href={/^https?:\/\//.test(l.url) ? l.url : base}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="inline-flex min-h-11 items-center break-words text-title underline"
                  >
                    {l.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  {l.description ? (
                    <p className="my-3 break-words text-body-ui text-ink-secondary">
                      {l.description}
                    </p>
                  ) : null}
                  <div className="mb-3 flex flex-wrap gap-2">
                    {l.tags.map((t) => (
                      <Link
                        className="inline-flex min-h-11 items-center"
                        href={`${base}?tag=${encodeURIComponent(t)}`}
                        key={t}
                      >
                        <Chip>{t}</Chip>
                      </Link>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      action={linkState.bind(null, workspaceSlug, {
                        id: l.id,
                        operation: pin ? "unpin" : "pin",
                      })}
                    >
                      {pin ? "Unpin" : "Pin to sidebar"}
                    </ActionButton>
                    {edit ? (
                      <ActionButton
                        action={linkState.bind(null, workspaceSlug, {
                          id: l.id,
                          operation: "delete",
                        })}
                        confirm={`Remove ${l.title}?`}
                      >
                        Remove…
                      </ActionButton>
                    ) : null}
                  </div>
                  {edit ? (
                    <div className="mt-4">
                      <LinkEditor slug={workspaceSlug} link={l} />
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card>
          No links here yet.{" "}
          {canContribute(ctx.membership) ? (
            "Add one for the crew."
          ) : (
            <Link className="underline" href={`/w/${workspaceSlug}`}>
              Back to my day
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}
