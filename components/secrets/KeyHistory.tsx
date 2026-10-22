"use client";

import { Form } from "./SecretForm";
import { Button } from "@/components/ui/button";
import { Field, Dropdown } from "@/components/ui/field";
import { Card } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
import type {
  VersionRow,
} from "@/lib/secrets/types";
import { lineDiff } from "@/lib/secrets/diff";
import type { SecretsSectionState } from "./useSecretsWorkspace";

export function renderKeyHistory(state: SecretsSectionState) {
  const {
    timezone,
    busy,
    versionDiff,
    setVersionDiff,
    setRevealed,
    history,
    setHistory,
    setConfirm,
    writable,
    readable,
    memberName,
    act,
    valueRequest,
  } = state;
  return (
    history ? (
      <Card>
        <h2 className="text-title">{history.key} history</h2>
        <p className="my-3 code-text" aria-label="Version values hidden">{versionDiff ? "Versions revealed" : "••••••••"}</p>
        <Form onSave={async v => {
          const before = await valueRequest({ operation: "version", secretId: history.id, versionId: v.before });
          const after = await valueRequest({ operation: "version", secretId: history.id, versionId: v.after });
          if (before && after) setVersionDiff({ before: before.value, after: after.value });
        }}><Field label="Earlier version"><Dropdown name="before">{history.versions.map(v => <option key={v.id} value={v.id}>{formatDayTime(v.createdAt, timezone)}</option>)}</Dropdown></Field><Field label="Later version"><Dropdown name="after">{history.versions.map(v => <option key={v.id} value={v.id}>{formatDayTime(v.createdAt, timezone)}</option>)}</Dropdown></Field><Button type="submit" variant="secondary" disabled={busy || history.versions.length < 2}>Reveal version diff</Button></Form>
        {versionDiff ? <div className="my-4"><pre className="whitespace-pre-wrap break-all code-text">{lineDiff(versionDiff.before, versionDiff.after).map(l => `${l.kind === "add" ? "+" : l.kind === "remove" ? "−" : " "} ${l.text}`).join("\n")}</pre><Button variant="quiet" onClick={() => setVersionDiff(null)}>Hide diff</Button></div> : null}
        {history.versions.map((v) => (
          <div
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3"
          >
            <span>
              {formatDayTime(v.createdAt, timezone)} ·{" "}
              {memberName(v.createdById)} ·{" "}
              {v.deleted ? "Deleted" : "Saved"}
            </span>
            <div className="flex gap-2">
              {readable ? (
                <Button
                  variant="quiet"
                  onClick={async () => {
                    const result = await valueRequest({
                      operation: "version",
                      secretId: history.id,
                      versionId: v.id,
                    });
                    if (result)
                      setRevealed((r) => ({
                        ...r,
                        [history.key]: result.value,
                      }));
                  }}
                >
                  Reveal version
                </Button>
              ) : null}
              {writable ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setConfirm({
                      title: "Restore this version?",
                      operation: "restore",
                      input: {
                        secretId: history.id,
                        versionId: v.id,
                      },
                    })
                  }
                >
                  Restore…
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {history.hasMore ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              const result = await act(
                "history",
                {
                  secretId: history.id,
                  cursor: history.versions.at(-1)?.id,
                },
                false,
              );
              if (Array.isArray(result)) {
                const batch = result as VersionRow[];
                setHistory((h) =>
                  h
                    ? {
                        ...h,
                        versions: [...h.versions, ...batch],
                        hasMore: batch.length === 200,
                      }
                    : h,
                );
              }
            }}
          >
            Older versions
          </Button>
        ) : null}
      </Card>
    ) : null
  );
}
