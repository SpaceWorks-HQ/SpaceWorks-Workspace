// Generated from app/invite/[token]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { findPendingInvitation } from "@/lib/invitations";
import { getCurrentUser } from "@/lib/permissions";

export async function loadInvitePage({ params }: PageProps<"/invite/[token]">) {
const { token } = await params;
const invitation = await findPendingInvitation(token);
const user = await getCurrentUser();
return viewDto({ invitation, user } as const);
}
