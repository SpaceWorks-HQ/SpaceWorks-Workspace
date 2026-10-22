import { PageHeader, Callout } from "@/components/ui/display";
import { JobsPanel } from "@/components/admin/JobsPanel";
import { getJobsHealth } from "@/lib/queue/admin";
import { requireSuperAdminMfa } from "@/lib/permissions";
export const metadata = { title: "Jobs" };
export default async function AdminJobsPage() {
  await requireSuperAdminMfa();
  const health = await getJobsHealth().catch(() => null);
  return <div className="flex flex-col gap-6">
    <PageHeader title="Jobs" description="Background work for this instance. Pausing stops new claims; active jobs finish. Completed jobs are kept for one day and failures for up to 30 days." />
    {health ? <JobsPanel health={health} /> : <Callout tone="warning" role="alert" title="Jobs are unavailable.">Check Redis and the worker and beat services, then refresh this page.</Callout>}
  </div>;
}
