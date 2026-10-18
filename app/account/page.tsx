import type { Metadata } from "next";
import { SimpleShell } from "@/components/chrome/SimpleShell";
import { AppearanceCard } from "@/components/account/AppearanceCard";
import { MfaCard } from "@/components/account/MfaCard";
import { PasswordForm } from "@/components/account/PasswordForm";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SessionsCard } from "@/components/account/SessionsCard";
import { Button } from "@/components/ui/button";
import { Card, PageHeader, SettingsRow } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { remainingRecoveryCodes } from "@/lib/mfa";
import { requireAuth } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";
import { listUserWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const sessionUser = await requireAuth();
  const [user, workspaces, remaining] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      select: { name: true, email: true, bio: true, pronouns: true, skills: true, timezone: true, passwordHash: true, mfaEnabledAt: true },
    }),
    listUserWorkspaces(sessionUser.id),
    remainingRecoveryCodes(sessionUser.id),
  ]);
  return (
    <SimpleShell>
      <div className="flex flex-col gap-6">
        <PageHeader title="Your account" description={user.email} />
        <Card padding="lg">
          <SettingsRow title="Profile" description="How the crew sees you across every workspace.">
            <ProfileForm initial={{ name: user.name ?? "", pronouns: user.pronouns ?? "", bio: user.bio ?? "", skills: user.skills, timezone: user.timezone ?? "" }} />
          </SettingsRow>
          <SettingsRow title="Password" description={user.passwordHash ? "Changing it signs you out on every device." : "You sign in with Google. Add a password as a fallback."}>
            <PasswordForm hasPassword={Boolean(user.passwordHash)} />
          </SettingsRow>
          <SettingsRow title="Two-step verification" description="A code from your phone at every sign-in.">
            <MfaCard enabled={Boolean(user.mfaEnabledAt)} remainingCodes={remaining} />
          </SettingsRow>
          <SettingsRow title="Appearance" description="Saved in this browser only.">
            <AppearanceCard />
          </SettingsRow>
          <SettingsRow title="Sessions" description="Lost a device? Sign out of every session at once.">
            <SessionsCard />
          </SettingsRow>
          <SettingsRow title="Your data" description="A JSON copy of your profile, memberships, tasks, messages, docs and shoutouts.">
            <Button asChild variant="secondary">
              <a href="/api/account/export" download>Download my data</a>
            </Button>
          </SettingsRow>
          <SettingsRow title="Workspaces" description="Where you're a member.">
            {workspaces.length === 0 ? (
              <p className="text-body-ui text-ink-muted">You aren&apos;t in any workspace yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {workspaces.map((workspace) => (
                  <li key={workspace.id} className="flex items-center justify-between gap-3">
                    <a href={`/w/${workspace.slug}`} className="font-semibold text-ink underline-offset-4 hover:underline">{workspace.name}</a>
                    <span className="text-caption text-ink-muted">{roleLabel(workspace.role)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsRow>
        </Card>
      </div>
    </SimpleShell>
  );
}
