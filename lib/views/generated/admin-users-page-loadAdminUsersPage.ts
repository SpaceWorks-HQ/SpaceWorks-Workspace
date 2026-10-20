// Generated from app/admin/users/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { viewerTimeZone } from "@/lib/format/datetime";
import { requireSuperAdminMfa } from "@/lib/permissions";

export async function loadAdminUsersPage() {
const session = await requireSuperAdminMfa();
const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, name: true, email: true, createdAt: true, lastSeenAt: true, disabledAt: true, mfaEnabledAt: true, _count: { select: { memberships: true } } },
  });
const tz = viewerTimeZone();
return viewDto({ session, users, tz } as const);
}
