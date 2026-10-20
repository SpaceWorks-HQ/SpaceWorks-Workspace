// Generated from app/admin/sso/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadSsoPage() {
await requireSuperAdminMfa();
const providers = await prisma.ssoProvider.findMany({
    where: { workspaceId: null },
    select: {
      id: true,
      name: true,
      issuer: true,
      clientId: true,
      allowedDomains: true,
      enabled: true,
    },
    orderBy: { createdAt: "asc" },
  });
return viewDto({ providers } as const);
}
