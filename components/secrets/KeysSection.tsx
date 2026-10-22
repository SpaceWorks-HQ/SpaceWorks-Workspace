"use client";

import { Form } from "./SecretForm";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card, Chip, EmptyState } from "@/components/ui/display";
import { formatDate } from "@/lib/format/datetime";
import type {
  VersionRow,
} from "@/lib/secrets/types";
import type { SecretsSectionState } from "./useSecretsWorkspace";
import { renderKeyHistory } from "./KeyHistory";
import { renderSecretEditor } from "./SecretEditor";

export function renderKeysSection(state: SecretsSectionState) {
  const {
    view,
    timezone,
    section,
    busy,
    filter,
    setFilter,
    revealEpoch,
    revealed,
    setRevealed,
    setHistory,
    setConfirm,
    project,
    environmentId,
    path,
    writable,
    readable,
    memberName,
    act,
    valueRequest,
    reveal,
    copy,
    edit,
    navigate,
  } = state;
  return (
    section === "Keys" ? (
      <>
        <Field label="Filter keys, tags or owner">
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </Field>
        {readable ? <Button variant="secondary" disabled={busy} aria-pressed={Object.keys(revealed).length > 0} onClick={async () => {
          if (Object.keys(revealed).length) { setRevealed({}); return; }
          const epoch = revealEpoch.current;
          const keys = view.rows.filter(r => !r.deletedAt && `${r.key} ${r.tags.join(" ")} ${memberName(r.ownerId)}`.toLowerCase().includes(filter.toLowerCase())).map(r => r.key);
          for (let offset = 0; offset < keys.length; offset += 500) {
            if (epoch !== revealEpoch.current) break;
            const result = await valueRequest({ operation: "reveal-view", keys: keys.slice(offset, offset + 500) });
            if (!result) break;
            setRevealed(r => ({ ...r, ...result.values }));
          }
        }}>{Object.keys(revealed).length ? "Hide values" : "Reveal values"}</Button> : null}
        {!view.rows.length ? (
          <EmptyState
            patch
            title="No keys in this folder yet. Add one for the application."
            action={
              writable ? (
                <Button asChild>
                  <a href="#secret-editor">Add a key</a>
                </Button>
              ) : undefined
            }
          />
        ) : !view.rows.some(r => `${r.key} ${r.tags.join(" ")} ${memberName(r.ownerId)}`.toLowerCase().includes(filter.toLowerCase())) ? (
          <EmptyState patch title="No keys match. Try another filter." action={<Button variant="secondary" onClick={() => setFilter("")}>Clear filter</Button>} />
        ) : (
          <div className="grid gap-3">
            {view.rows
              .filter((r) =>
                `${r.key} ${r.tags.join(" ")} ${memberName(r.ownerId)}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((row) => (
                <Card key={row.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="break-all code-text text-title">
                      {row.key}{" "}
                      {row.deletedAt ? <Chip>Deleted</Chip> : null}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {readable && !row.deletedAt ? (
                        <>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void reveal(row.key)}
                          >
                            {Object.hasOwn(revealed, row.key) ? "Hide" : "Reveal"}
                          </Button>
                          <Button variant="quiet" disabled={busy} onClick={() => void copy(row.key)} aria-label={`Copy ${row.key}`}>Copy</Button>
                          {writable ? (
                            <Button
                              variant="quiet"
                              disabled={busy}
                              onClick={() => void edit(row)}
                            >
                              Edit
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={async () => {
                          const versions = await act(
                            "history",
                            { secretId: row.id },
                            false,
                          );
                          if (versions)
                            setHistory({
                              id: row.id,
                              key: row.key,
                              versions: versions as VersionRow[],
                              hasMore:
                                (versions as VersionRow[]).length === 200,
                            });
                        }}
                      >
                        History
                      </Button>
                      {writable && !row.deletedAt ? (
                        <Button
                          variant="dangerQuiet"
                          onClick={() =>
                            setConfirm({
                              title: `Delete ${row.key}?`,
                              operation: "change",
                              input: {
                                changes: [
                                  { key: row.key, path, delete: true },
                                ],
                              },
                            })
                          }
                        >
                          Delete…
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {Object.hasOwn(revealed, row.key) ? (
                    <div className="mt-3">
                      <pre className="whitespace-pre-wrap break-all code-text">
                        {revealed[row.key]}
                      </pre>
                      <Button
                        variant="quiet"
                        onClick={() =>
                          setRevealed((r) => {
                            const next = { ...r };
                            delete next[row.key];
                            return next;
                          })
                        }
                      >
                        Hide value
                      </Button>
                    </div>
                  ) : (
                    <p
                      className="code-text text-ink-muted"
                      aria-label="Value hidden"
                    >
                      ••••••••
                    </p>
                  )}
                  <p className="mt-2 break-words text-body-ui">
                    {row.comment}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {memberName(row.ownerId)} ·{" "}
                    {row.tags.join(", ") || "No tags"} · Updated{" "}
                    {formatDate(row.updatedAt, timezone)}
                    {row.rotateEveryDays
                      ? ` · Rotate every ${row.rotateEveryDays} days`
                      : ""}
                  </p>
                </Card>
              ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {view.keysCursor ? (
            <Button variant="secondary" onClick={() => navigate(project.id, environmentId, path)}>
              First keys
            </Button>
          ) : null}
          {view.nextKeysCursor ? (
            <Button variant="secondary" onClick={() => navigate(project.id, environmentId, path, undefined, view.nextKeysCursor)}>
              Show more
            </Button>
          ) : null}
        </div>
        {renderKeyHistory(state)}
        {renderSecretEditor(state)}
        {writable ? (
          <details className="rounded-xl border border-line bg-panel p-4">
            <summary className="min-h-11 cursor-pointer">
              Add a folder
            </summary>
            <Form onSave={async (v) => act("folder", { path: v.path })}>
              <Field label="Folder path">
                <Input name="path" defaultValue="/api" required />
              </Field>
              <Button type="submit" variant="secondary" disabled={busy}>
                Create folder
              </Button>
            </Form>
          </details>
        ) : null}
      </>
    ) : null
  );
}
