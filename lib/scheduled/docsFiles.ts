import "server-only";

import { purgeDeletedFiles } from "@/lib/files/service";

/**
 * Periodic work for docs and files.
 *
 * - Purges library files deleted more than 30 days ago (objects, versions,
 *   rows), skipping workspaces on legal hold. Old file versions beyond the
 *   newest 20 are pruned when a new version is added, so nothing is left here.
 * - Doc verification reminders: the docs home lists each member's pages whose
 *   "verified until" date has passed or is close (lib/docs/review.ts). A push
 *   reminder needs a `doc.verification_due` event in the notification
 *   catalogue; until it exists nothing is dispatched from here.
 *
 * Called about once a minute by every replica; the purge runs at most every
 * ten minutes per process and claims rows under a lock, so it is idempotent.
 */

const LAST_RUN = Symbol.for("sww.scheduled.docsFiles.lastPurge");
const PURGE_EVERY_MS = 10 * 60_000;

export async function run(now: Date): Promise<void> {
  const g = globalThis as typeof globalThis & { [LAST_RUN]?: number };
  if (g[LAST_RUN] && now.getTime() - g[LAST_RUN] < PURGE_EVERY_MS) return;
  g[LAST_RUN] = now.getTime();
  await purgeDeletedFiles(now);
}
