"use client";

import { Card } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderSecuritySection(state: SecretsSectionState) {
  const {
    view,
    timezone,
    section,
    project,
    memberName,
  } = state;
  return (
    section === "Security" && view.overview ? (
      <Card>
        <h2 className="mb-4 text-h3">{project.name} security overview</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt>Keys overdue for rotation</dt>
            <dd>
              {view.overview.overdue.length} ·{" "}
              {view.overview.overdue.join(", ") || "None"}
            </dd>
          </div>
          <div>
            <dt>Active tokens without expiry</dt>
            <dd>{view.overview.tokensWithoutExpiry}</dd>
          </div>
          <div>
            <dt>Unused tokens (30 days)</dt>
            <dd>{view.overview.unusedTokens}</dd>
          </div>
          <div>
            <dt>Recent reveals</dt>
            <dd>{view.overview.recentReveals.length}</dd>
          </div>
        </dl>
        <p className="mt-4 text-caption text-ink-muted">
          Across environments you administer.
        </p>
        {view.overview.recentReveals.slice(0, 10).map((e) => (
          <p key={e.id} className="text-caption">
            {formatDayTime(e.createdAt, timezone)} ·{" "}
            {memberName(e.actorId)} · {e.action}
          </p>
        ))}
        {view.overview.productionHolders.length ? (
          <>
            <h3 className="mt-6 text-title">Production access holders</h3>
            <ul>
              {view.overview.productionHolders.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
    ) : null
  );
}
