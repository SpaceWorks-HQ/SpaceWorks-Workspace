// Generated from app/admin/jobs/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getJobsHealth } from "@/lib/queue/admin";
import { requireSuperAdminMfa } from "@/lib/permissions";

export async function loadAdminJobsPage() {
await requireSuperAdminMfa();
const health = await getJobsHealth().catch(() => null);
return viewDto({ health } as const);
}
