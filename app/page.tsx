import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Callout } from "@/components/ui/display";
import { getCurrentUser, isSuperAdminEmail } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { listUserWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Space Works Workspace" };

/** Entry point: setup → sign in → last (or first) workspace → "no workspace yet". */
export default async function HomeRedirect() {
  if (await isSetupOpen()) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspaces = await listUserWorkspaces(user.id);
  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const target = workspaces.find((workspace) => workspace.slug === last) ?? workspaces[0];
  if (target) redirect(`/w/${target.slug}`);

  return (
    <AuthFrame title="No workspace yet." description={`You're signed in as ${user.email}, but you aren't a member of any workspace.`}>
      <Callout tone="info">Ask a workspace admin to invite you. The invitation link signs you straight in.</Callout>
      <div className="flex flex-wrap gap-2">
        {isSuperAdminEmail(user.email) ? <a href="/admin" className="text-sm font-semibold text-ink underline underline-offset-4">Open instance admin</a> : null}
        <SignOutButton />
      </div>
    </AuthFrame>
  );
}
