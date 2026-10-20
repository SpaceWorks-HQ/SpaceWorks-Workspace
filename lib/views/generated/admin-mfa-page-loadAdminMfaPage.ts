// Generated from app/admin-mfa/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/permissions";

export async function loadAdminMfaPage() {
const session = await requireSuperAdmin();
const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { mfaEnabledAt: true } });
return viewDto({ user } as const);
}
