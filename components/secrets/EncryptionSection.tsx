"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderEncryptionSection(state: SecretsSectionState) {
  const {
    view,
    timezone,
    section,
    busy,
    setConfirm,
    project,
    admin,
  } = state;
  return (
    section === "Encryption" && admin && view.encryption ? <Card>
      <h2 className="mb-4 text-h3">Encryption hierarchy</h2>
      <p>Root → workspace key → project data key → secret values. Keys stay inside the server.</p>
      <dl className="my-4 grid gap-3 sm:grid-cols-2"><div><dt>Root key version</dt><dd>{view.encryption.rootVersion}</dd></div><div><dt>Workspace key</dt><dd className="break-all">Version {view.encryption.workspaceVersion} · {view.encryption.workspaceFingerprint}</dd></div><div><dt>Project data key</dt><dd className="break-all">Version {view.encryption.projectVersion} · {view.encryption.projectFingerprint}</dd></div><div><dt>Algorithm</dt><dd>{view.encryption.algorithm}</dd></div><div><dt>Project key created / rotated</dt><dd>{formatDayTime(view.encryption.createdAt, timezone)}</dd></div><div><dt>Workspace key created / rotated</dt><dd>{formatDayTime(view.encryption.workspaceCreatedAt, timezone)}</dd></div></dl>
      {view.encryption.lastJob ? <p role="status">Last {view.encryption.lastJob.kind} rotation: {view.encryption.lastJob.status.toLowerCase()} · {view.encryption.lastJob.processed} of {view.encryption.lastJob.total} records · {formatDayTime(view.encryption.lastJob.createdAt, timezone)}</p> : <p>No rotations yet.</p>}
      <p className="my-3 text-ink-muted">Verify a fresh two-step code above before rotating. Existing values remain available while the background job runs.</p>
      <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={busy} onClick={() => setConfirm({ title: "Rotate this project data key?", operation: "rotate-key", input: { projectId: project.id, kind: "project" } })}>Rotate data key…</Button><Button variant="secondary" disabled={busy} onClick={() => setConfirm({ title: "Rotate the workspace key?", operation: "rotate-key", input: { projectId: project.id, kind: "workspace" } })}>Rotate workspace key…</Button></div>
    </Card> : null
  );
}
