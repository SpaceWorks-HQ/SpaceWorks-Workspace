// Generated from app/admin/outbox/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { viewerTimeZone } from "@/lib/format/datetime";
import { getOutboxHealth } from "@/lib/outbox";
import { requireSuperAdminMfa } from "@/lib/permissions";

export async function loadAdminOutboxPage() {
await requireSuperAdminMfa();
const health = await getOutboxHealth();
const tz = viewerTimeZone();
const beat = health.heartbeat;
return viewDto({ health, tz, beat } as const);
}
