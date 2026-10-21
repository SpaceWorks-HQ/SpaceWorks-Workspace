"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { revokeSecretsCliSession } from "@/app/actions/secrets";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format/datetime";
export function CliSessions({
  sessions,
  timezone,
}: {
  sessions: {
    id: string;
    name: string;
    createdAt: Date | string;
    lastUsedAt: Date | string | null;
    refreshExpiresAt: Date | string;
  }[];
  timezone: string;
}) {
  const router = useRouter(),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3">
      {error ? <p role="alert">{error}</p> : null}
      {sessions.length ? (
        sessions.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <p className="break-all font-semibold">{s.name}</p>
              <p className="text-caption text-ink-muted">
                {s.lastUsedAt
                  ? `Used ${formatDate(s.lastUsedAt, timezone)}`
                  : "Never used"}{" "}
                · Expires {formatDate(s.refreshExpiresAt, timezone)}
              </p>
            </div>
            <Button variant="dangerQuiet" onClick={() => setSelected(s.id)}>
              Revoke…
            </Button>
          </div>
        ))
      ) : (
        <p>No authorised CLI devices.</p>
      )}
      <ConfirmDialog
        open={!!selected}
        title="Revoke this CLI session?"
        confirmLabel="Revoke session"
        loading={busy}
        onCancel={() => setSelected(null)}
        onConfirm={async () => {
          if (!selected) return;
          setBusy(true);
          try {
            const r = await revokeSecretsCliSession(selected);
            if (!r.ok) setError(r.error ?? "Couldn't revoke this session.");
            else {
              setSelected(null);
              router.refresh();
            }
          } catch {
            setError("Couldn't revoke this session. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
