import { Card, CardHeader, EmptyState, PageHeader, StatTile } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDayTime, formatRelativeTime, viewerTimeZone } from "@/lib/format/datetime";
import { getOutboxHealth } from "@/lib/outbox";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Email outbox" };

export default async function AdminOutboxPage() {
  await requireSuperAdminMfa();
  const health = await getOutboxHealth();
  const tz = viewerTimeZone();
  const beat = health.heartbeat;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Email outbox" description="Queued email is delivered by the background worker. POST /api/internal/outbox queues due deliveries for external cron setups." />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Waiting" value={health.counts.PENDING} hint={health.oldestPendingAt ? `Oldest ${formatRelativeTime(health.oldestPendingAt, tz).toLowerCase()}` : undefined} />
        <StatTile label="Sending" value={health.counts.PROCESSING} />
        <StatTile label="Sent (kept 30 days)" value={health.counts.SENT} />
        <StatTile label="Failed" value={health.counts.FAILED} tone={health.counts.FAILED > 0 ? "attention" : "default"} />
      </section>
      <Card>
        <CardHeader title="Worker" />
        {beat ? (
          <ul className="flex flex-col gap-1.5 text-body-ui text-ink">
            <li>Last run started: {beat.lastStartedAt ? formatDayTime(beat.lastStartedAt, tz) : "never"}</li>
            <li>Last success: {beat.lastSucceededAt ? `${formatDayTime(beat.lastSucceededAt, tz)} (${beat.lastSent} sent, ${beat.lastFailed} failed)` : "never"}</li>
            {beat.lastError ? <li className="text-danger-fg">Last error: {beat.lastError}</li> : null}
          </ul>
        ) : (
          <p className="text-body-ui text-ink-muted">The worker hasn&apos;t run yet.</p>
        )}
      </Card>
      {health.recentFailures.length === 0 ? (
        <EmptyState title="No failed emails.">Failures show here with a short reason, never the message content.</EmptyState>
      ) : (
        <Table label="Failed emails">
          <THead><tr><TH>Kind</TH><TH>Attempts</TH><TH>Reason</TH><TH>Queued</TH></tr></THead>
          <TBody>
            {health.recentFailures.map((failure) => (
              <TR key={failure.id}>
                <TD>{failure.kind}</TD>
                <TD className="tabular-nums">{failure.attempts}</TD>
                <TD className="text-ink-muted">{failure.lastError ?? "Unknown"}</TD>
                <TD className="whitespace-nowrap text-ink-muted">{formatDayTime(failure.createdAt, tz)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
