import { NextResponse } from "next/server";
import { runScheduledJobs } from "@/lib/scheduled";
import { bearerSecretMatches } from "@/lib/bearerSecret";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/**
 * Periodic jobs hook for external schedulers (`Authorization: Bearer $CRON_SECRET`).
 *
 * Contract (callers: the VPS `scheduler` container, the Helm CronJob, the
 * Cloudflare cron Worker, Render/DO scheduled jobs; all via scripts/scheduler.mjs
 * or deploy/cloudflare-cron):
 * - `POST` about once a minute. Calls may overlap, repeat or be skipped, so
 *   every job must be idempotent, claim its own due work atomically (row
 *   claims or Redis locks) and decide for itself whether it is due.
 * - Wrong or missing bearer: `404 Not found`, like every internal endpoint.
 * - Success with nothing to report: `204 No Content`. A job runner may
 *   instead answer `200 {"ok":true,...counts}`; schedulers treat any 2xx as success.
 * - Failure: `500 {"ok":false}` without details; log server-side only.
 * - Finish well inside 55 seconds; hand longer work to the outbox or a queue.
 *
 * Planned jobs: assistant scheduled jobs and digests (`ScheduledJob`) and
 * service monitor checks. Until those phases land there is nothing to run.
 */
export async function POST(request: Request) {
  if (!bearerSecretMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new NextResponse("Not found", { status: 404, headers: privateHeaders });
  }
  const result = await runScheduledJobs();
  return result.failed.length ? NextResponse.json({ ok: false }, { status: 500, headers: privateHeaders }) : new NextResponse(null, { status: 204, headers: privateHeaders });
}
