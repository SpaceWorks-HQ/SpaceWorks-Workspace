"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, Dropdown, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import {
  saveConflictLink,
  freezeGovernancePack,
} from "@/app/actions/govextras";
import type { ConflictData } from "@/lib/govextras/conflicts";
export function ConflictLinks({
  slug,
  id,
  data,
}: {
  slug: string;
  id: string;
  data: ConflictData;
}) {
  const [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <section className="space-y-4">
      <h3 className="text-h3">Related transactions and decisions</h3>
      {data.warnings.length ? (
        <Callout title="Declared party appears as vendor or payee">
          <ul>
            {data.warnings.map((t) => (
              <li key={`${t.type}:${t.id}`}>
                {t.type}: {t.label}
              </li>
            ))}
          </ul>
          <p>
            Review the declaration and record management or recusal notes. Exact
            names and linked organisations are checked; aliases need manual
            review.
          </p>
        </Callout>
      ) : (
        <p className="text-ink-muted">
          No matching vendor or payee in the current selection. Check aliases
          manually.
        </p>
      )}
      <ul className="space-y-2">
        {data.links.map((l) => (
          <li key={l.id} className="break-words">
            {l.toType} ·{" "}
            {data.targets.find((t) => t.id === l.toId && t.type === l.toType)
              ?.label ?? "Record retained by ID"}{" "}
            · {l.label}
          </li>
        ))}
      </ul>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            [targetType, targetId] = String(f.get("target")).split(":");
          start(async () => {
            try {
              const r = await saveConflictLink(slug, {
                declarationId: id,
                targetType,
                targetId,
                note: f.get("note"),
              });
              setMessage(r.ok ? "Related record saved." : r.error);
              router.refresh();
            } catch {
              setMessage("Couldn't save. Try again.");
            }
          });
        }}
      >
        <Field label="Related record">
          <Dropdown name="target" required>
            <option value="">Choose a record</option>
            {data.targets.map((t) => (
              <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>
                {t.type} · {t.label}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Management / recusal note">
          <Textarea name="note" maxLength={2000} />
        </Field>
        <Button variant="secondary" type="submit" disabled={pending}>
          Link related record
        </Button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
export function FreezePack({ slug, id }: { slug: string; id: string }) {
  const [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <div className="space-y-3">
      <p>
        Save and review the selected period, reports, decisions and evidence
        first. Freezing locks the record and stores its PDF and evidence bundle
        permanently.
      </p>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await freezeGovernancePack(slug, id);
              setMessage(
                r.ok ? "Pack frozen. PDF and bundle are ready below." : r.error,
              );
              router.refresh();
            } catch {
              setMessage("Couldn't freeze. Try again.");
            }
          })
        }
      >
        {pending ? "Freezing" : "Freeze saved pack"}
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
