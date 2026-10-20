// Generated from app/admin/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireSuperAdminMfa } from "@/lib/permissions";

export async function loadAdminLayout({ children }: { children: React.ReactNode }) {
await requireSuperAdminMfa();
return viewDto({  } as const);
}
