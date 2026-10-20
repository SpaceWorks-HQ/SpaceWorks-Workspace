// Generated from app/w/[workspaceSlug]/shoutouts/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { canGiveShoutouts } from "@/lib/community/access";
import { listShoutouts, shoutoutCountsByRecipient } from "@/lib/community/shoutouts";

export async function loadShoutoutsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/shoutouts">) {
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
return viewDto({ ctx, workspace, tz, members, personId, direction, person, shoutouts, leaders, canGive, toParam, base } as const);
}
