"use client";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { TR, TH, TD } from "@/components/ui/table";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderCompareSection(state: SecretsSectionState) {
  const {
    view,
    section,
    busy,
    revealed,
    project,
    environmentId,
    reveal,
    table,
  } = state;
  return (
    section === "Compare" ? (
      <>
        <h2 className="text-h3">Keys across environments</h2>
        <p className="text-body-ui text-ink-muted">
          Only environments you can list appear here. Missing keys can
          prevent deployments.
        </p>
        {table(
          ["Key", ...project.environments.map((e) => e.name)],
          view.comparison.map((r) => (
            <TR key={r.key}>
              <TH scope="row" className="code-text text-ink">{r.key}</TH>
              {project.environments.map((e) => (
                <TD key={e.id}>
                  {r.environmentIds.includes(e.id) && ["READ", "WRITE", "ADMIN"].includes(e.accessRole) ? <div className="grid gap-2"><pre className="max-w-64 whitespace-pre-wrap break-all code-text">{revealed[e.id === environmentId ? r.key : e.id + ":" + r.key] ?? "••••••••"}</pre><Button variant="quiet" disabled={busy} aria-label={`Reveal ${r.key} in ${e.name}`} onClick={() => void reveal(r.key, e.id)}>Show / hide</Button></div> : null}
                  <Chip
                    tone={
                      r.environmentIds.includes(e.id)
                        ? "success"
                        : "warning"
                    }
                  >
                    {r.environmentIds.includes(e.id)
                      ? "Defined"
                      : "Missing"}
                  </Chip>
                </TD>
              ))}
            </TR>
          )),
        )}
      </>
    ) : null
  );
}
