// Generated from app/account/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listCliSessions } from "@/lib/secrets/device";
import { prisma } from "@/lib/db";
import { remainingRecoveryCodes } from "@/lib/mfa";
import { requireAuth } from "@/lib/permissions";
import { listUserWorkspaces } from "@/lib/workspaces";

export async function loadAccountPage() {
const sessionUser = await requireAuth();
const [user, workspaces, remaining] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      select: { name: true, email: true, bio: true, pronouns: true, skills: true, timezone: true, passwordHash: true, mfaEnabledAt: true },
    }),
    listUserWorkspaces(sessionUser.id),
    remainingRecoveryCodes(sessionUser.id),
  ]);
const cliSessions = await listCliSessions(sessionUser.id);
const hasPassword = Boolean(user.passwordHash);
return viewDto({ user, workspaces, remaining, cliSessions, hasPassword } as const);
}
