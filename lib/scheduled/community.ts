import "server-only";
import { publishDueAnnouncements } from "@/lib/community/announcements";

/** Publishing uses per-announcement idempotency keys across replicas. */
export async function run(now: Date): Promise<void> {
  await publishDueAnnouncements(now);
}
