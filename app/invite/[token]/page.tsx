import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { AcceptInvite } from "@/components/auth/AcceptInvite";
import { Callout } from "@/components/ui/display";
import { findPendingInvitation } from "@/lib/invitations";
import { getCurrentUser } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";

export const metadata: Metadata = { title: "Join a workspace", referrer: "no-referrer" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await findPendingInvitation(token);
  if (!invitation) {
    return (
      <AuthFrame title="This invitation isn't valid." description="It may have expired, been revoked or already been used.">
        <Callout tone="info">Ask the person who invited you to send a new invitation. <Link href="/login" className="font-semibold underline underline-offset-4">Go to sign in</Link></Callout>
      </AuthFrame>
    );
  }
  const user = await getCurrentUser();
  const mode = user
    ? user.email.toLowerCase() === invitation.email.toLowerCase() ? "signed-in-match" : "signed-in-other"
    : invitation.existingAccount ? "existing" : "new";
  const inviter = invitation.invitedBy?.name?.trim();
  return (
    <AuthFrame
      title={`Join ${invitation.workspace.name}.`}
      description={`${inviter ? `${inviter} invited you` : "You're invited"} to join as ${roleLabel(invitation.role).toLowerCase()}.${invitation.workspace.tagline ? ` ${invitation.workspace.tagline}` : ""}`}
    >
      <AcceptInvite token={token} email={invitation.email} workspaceName={invitation.workspace.name} mode={mode} />
    </AuthFrame>
  );
}
