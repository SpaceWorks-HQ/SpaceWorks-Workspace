"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { TR, TD } from "@/components/ui/table";
import { formatDayTime } from "@/lib/format/datetime";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderAuditSection(state: SecretsSectionState) {
  const {
    view,
    timezone,
    section,
    busy,
    filter,
    setFilter,
    auditFrom,
    setAuditFrom,
    auditUntil,
    setAuditUntil,
    project,
    admin,
    auditStart,
    auditEnd,
    memberName,
    valueRequest,
    table,
  } = state;
  return (
    section === "Audit" && admin ? (
      <>
        <Field label="Filter audit actions">
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From date" optional>
            <Input
              type="date"
              value={auditFrom}
              onChange={(e) => setAuditFrom(e.target.value)}
            />
          </Field>
          <Field label="To date" optional>
            <Input
              type="date"
              value={auditUntil}
              onChange={(e) => setAuditUntil(e.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void valueRequest(
              {
                operation: "audit",
                projectId: project.id,
                environmentId: "",
                from: auditFrom,
                until: auditUntil,
                ...(filter ? { action: filter } : {}),
              },
              "secrets-audit.csv",
            )
          }
        >
          Export project audit CSV
        </Button>
        <p className="text-caption text-ink-muted">
          Recent activity in this environment. Project CSV includes every
          environment you administer.
        </p>
        {table(
          ["When", "Action", "Member"],
          view.audit
            .filter(
              (a) =>
                a.action.includes(filter) &&
                (!auditStart ||
                  new Date(a.createdAt).getTime() >=
                    new Date(auditStart).getTime()) &&
                (!auditEnd ||
                  new Date(a.createdAt).getTime() <
                    new Date(auditEnd).getTime() + 60000),
            )
            .map((a) => (
              <TR key={a.id}>
                <TD>
                  {formatDayTime(a.createdAt, timezone)}
                </TD>
                <TD>{a.action}</TD>
                <TD>{memberName(a.actorId)}</TD>
              </TR>
            )),
        )}
      </>
    ) : null
  );
}
