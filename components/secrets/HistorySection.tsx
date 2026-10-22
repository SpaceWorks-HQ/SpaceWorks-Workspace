"use client";

import { Form } from "./SecretForm";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card, EmptyState } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
import type {
  SnapshotDiff,
} from "@/lib/secrets/types";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderHistorySection(state: SecretsSectionState) {
  const {
    view,
    slug,
    timezone,
    section,
    busy,
    diff,
    setDiff,
    setConfirm,
    project,
    environmentId,
    path,
    writable,
    memberName,
    act,
    navigate,
  } = state;
  return (
    section === "History" ? (
      <>
        {writable ? (
          <Form onSave={async (v) => act("snapshot", { label: v.label })}>
            <Field label="Snapshot name">
              <Input
                id="snapshot-name"
                name="label"
                maxLength={100}
                required
                placeholder="Before the website deployment"
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={busy}>
              Take snapshot
            </Button>
          </Form>
        ) : null}
        {view.snapshots.length ? (
          view.snapshots.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="text-title">
                    {s.label} · Revision {s.revision}
                  </h2>
                  <p>
                    {formatDayTime(s.createdAt, timezone)} ·{" "}
                    {memberName(s.createdById)}
                  </p>
                </div>
                {writable ? (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        const result = await act(
                          "diff",
                          { snapshotId: s.id },
                          false,
                        );
                        if (result) setDiff(result as SnapshotDiff);
                      }}
                    >
                      Compare
                    </Button>
                    <Button
                      variant="dangerOutline"
                      onClick={() =>
                        setConfirm({
                          title: "Restore this environment snapshot?",
                          operation: "rollback",
                          input: { snapshotId: s.id },
                        })
                      }
                    >
                      Restore…
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))
        ) : (
          <EmptyState patch title="No snapshots yet. Take one before your next deployment." action={writable ? <Button asChild variant="secondary"><a href="#snapshot-name">Take a snapshot</a></Button> : undefined} />
        )}
        <div className="flex flex-wrap gap-2">
          {view.snapshotCursor ? (
            <Button
              variant="secondary"
              onClick={() => navigate(project.id, environmentId, path)}
            >
              Newest snapshots
            </Button>
          ) : null}
          {view.snapshots.length === 100 ? (
            <Button
              variant="secondary"
              onClick={() =>
                navigate(
                  project.id,
                  environmentId,
                  path,
                  view.snapshots.at(-1)?.id,
                )
              }
            >
              Older snapshots
            </Button>
          ) : null}
        </div>
        {diff.length ? (
          <Card>
            <h2 className="text-title">
              Changes from current environment to selected snapshot
            </h2>
            {diff.map((d) => (
              <p key={d.path + d.key} className="break-all">
                {d.path} / {d.key} · {d.operation}
              </p>
            ))}
          </Card>
        ) : null}
        <h2 className="text-h3">Protected changes</h2>
        <a
          className="inline-flex min-h-11 items-center text-accent-text underline"
          href={`/w/${slug}/requests/approvals`}
        >
          Open approvals
        </a>
        {view.changes.length ? (
          view.changes.map((c) => (
            <Card key={c.id}>
              <p>
                {c.status.toLowerCase()} · Revision {c.revision} ·{" "}
                {memberName(c.createdById)}
              </p>
              <pre className="code-text overflow-x-auto whitespace-pre-wrap break-all text-caption">
                {JSON.stringify(c.diff, null, 2)}
              </pre>
            </Card>
          ))
        ) : (
          <p>No change requests yet.</p>
        )}
      </>
    ) : null
  );
}
