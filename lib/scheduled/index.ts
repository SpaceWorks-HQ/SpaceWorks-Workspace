import "server-only";
import { run as moneyControls } from "@/lib/scheduled/moneyControls";
import { run as social } from "@/lib/scheduled/social";

import { run as calendar } from "@/lib/scheduled/calendar";
import { run as opsGaps } from "@/lib/scheduled/opsGaps";
import { run as appReviews } from "@/lib/scheduled/appReviews";
import { run as governance } from "@/lib/scheduled/governance";
import { run as tasks } from "@/lib/scheduled/tasks";
import { run as chat } from "@/lib/scheduled/chat";
import { run as docsFiles } from "@/lib/scheduled/docsFiles";
import { run as community } from "@/lib/scheduled/community";
import { run as finance } from "@/lib/scheduled/finance";
import { run as assistant } from "@/lib/scheduled/assistant";
import { run as integrations } from "@/lib/scheduled/integrations";
import { run as monitor } from "@/lib/scheduled/monitor";
import { run as people } from "@/lib/scheduled/people";
import { run as opsMoney } from "@/lib/scheduled/opsMoney";
import { run as collaboration } from "@/lib/scheduled/collaboration";
import { run as shell } from "@/lib/scheduled/shell";

/**
 * Periodic jobs, one module per build area. Each area replaces the body of
 * its own file and never edits this registry. A failing job is logged and
 * does not stop the others.
 */
export const SCHEDULED_JOBS: ReadonlyArray<{ area: string; run: (now: Date) => Promise<void> }> = [
  { area: "money-controls", run: moneyControls },
  { area: "ops-gaps", run: opsGaps },
  { area: "social", run: social },
  { area: "team-calendar", run: calendar },
  { area: "app-reviews", run: appReviews },
  { area: "governance-tools", run: governance },
  { area: "tasks", run: tasks },
  { area: "chat", run: chat },
  { area: "docs-files", run: docsFiles },
  { area: "community", run: community },
  { area: "finance", run: finance },
  { area: "assistant", run: assistant },
  { area: "integrations-messaging", run: integrations },
  { area: "monitor", run: monitor },
  { area: "people-relationships", run: people },
  { area: "ops-money", run: opsMoney },
  { area: "work-collaboration", run: collaboration },
  { area: "platform-shell", run: shell },
];

export async function runScheduledJobs(now = new Date()) {
  const failed: string[] = [];
  for (const job of SCHEDULED_JOBS) {
    try {
      await job.run(now);
    } catch {
      failed.push(job.area);
      console.error(`[scheduler] ${job.area} job failed`);
    }
  }
  return { ran: SCHEDULED_JOBS.length, failed };
}
