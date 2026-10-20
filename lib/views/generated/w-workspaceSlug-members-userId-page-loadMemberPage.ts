// Generated from app/w/[workspaceSlug]/members/[userId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { profileOrganisation } from "@/lib/orgPeople/service";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { memberProfile } from "@/lib/people/profiles";
import { certifications } from "@/lib/people/certifications";
import { visibleAvailability } from "@/lib/people/away";

export async function loadMemberPage({ params }: PageProps<"/w/[workspaceSlug]/members/[userId]">) {
const { workspaceSlug, userId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const member = await memberProfile(ctx, userId);
if (!member) notFound();
const now = new Date();
const [away, certs] = await Promise.all([visibleAvailability(ctx, [userId], { startsAt: now, endsAt: new Date(now.getTime() + 30 * 86400000) }), certifications(ctx, userId)]);
const base = `/w/${workspaceSlug}`;
const organisation = await profileOrganisation(ctx, userId);
return viewDto({ ctx, member, now, away, certs, base, organisation } as const);
}
