"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manageJobsAction } from "@/app/actions/jobs";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Chip, EmptyState, Callout } from "@/components/ui/display";
import type { JobsHealth } from "@/lib/queue/admin";
import type { QueueName } from "@/lib/queue/definitions";

export function JobsPanel({ health }: { health: JobsHealth }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  function manage(queue: QueueName, operation: "pause" | "resume" | "retry" | "remove", jobId?: string) {
    start(async () => {
      try {
        const result = await manageJobsAction({ queue, operation, jobId });
        setFailed(!result.ok);
        setMessage(result.ok ? "Queue updated." : result.error);
        if (result.ok) router.refresh();
      } catch { setFailed(true); setMessage("The queue could not be updated. Refresh and try again."); }
    });
  }
  return <div className="flex flex-col gap-5" aria-busy={pending}>
    <div><Button variant="secondary" disabled={pending} onClick={() => start(() => router.refresh())}>Refresh jobs</Button></div>
    {message ? <Callout role={failed ? "alert" : "status"} tone={failed ? "danger" : "success"}>{message}</Callout> : null}
    <div className="grid gap-4 lg:grid-cols-2">
      {health.map(queue => <Card key={queue.name}>
        <CardHeader title={<span className="capitalize">{queue.name}</span>} action={<Chip tone={queue.paused ? "warning" : "success"}>{queue.paused ? "Paused" : "Running"}</Chip>} />
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {["waiting", "active", "completed", "failed", "delayed", "paused"].map(state => <div key={state}><dt className="capitalize text-body-ui text-ink-muted">{state}</dt><dd className="text-title tabular-nums text-ink">{queue.counts[state] ?? 0}</dd></div>)}
        </dl>
        <Button variant="secondary" disabled={pending} onClick={() => manage(queue.name, queue.paused ? "resume" : "pause")} aria-label={`${queue.paused ? "Resume" : "Pause"} ${queue.name} queue`}>{queue.paused ? "Resume queue" : "Pause queue"}</Button>
        {queue.failures.length ? <ul className="mt-4 flex flex-col gap-4" aria-label={`${queue.name} recent failures`}>
          {queue.failures.map(job => <li key={job.id} className="border-t border-line pt-4 text-body-ui">
            <p className="break-words text-ink">{job.reason}</p>
            <p className="mt-1 text-ink-muted">{job.attempts} attempts · <time dateTime={new Date(job.at).toISOString()}>{new Date(job.at).toISOString().replace("T", " ").slice(0, 16)} UTC</time></p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={pending} onClick={() => manage(queue.name, "retry", job.id)} aria-label={`Retry failed job ${job.id}`}>Retry job</Button>
              <Button variant="ghost" disabled={pending} onClick={() => manage(queue.name, "remove", job.id)} aria-label={`Remove failed job ${job.id}`}>Remove job</Button>
            </div>
          </li>)}
        </ul> : null}
      </Card>)}
    </div>
    {health.every(queue => queue.failures.length === 0) ? <EmptyState patch title="No failed jobs." action={<Button variant="secondary" disabled={pending} onClick={() => start(() => router.refresh())}>Refresh jobs</Button>} /> : null}
  </div>;
}
