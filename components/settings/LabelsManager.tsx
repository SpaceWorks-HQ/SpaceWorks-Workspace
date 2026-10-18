"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LabelTone } from "@prisma/client";
import { createLabelAction, deleteLabelAction, updateLabelAction } from "@/app/actions/workspace-settings";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Chip, EmptyState, type ChipTone } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { LABEL_TONES, labelChipTone } from "@/lib/labels";

type LabelRow = { id: string; name: string; tone: LabelTone; taskCount: number };

function ToneSelect({ value, onChange, label }: { value: LabelTone; onChange: (tone: LabelTone) => void; label: string }) {
  return (
    <Dropdown aria-label={label} value={value} onChange={(e) => onChange(e.target.value as LabelTone)}>
      {LABEL_TONES.map((tone) => <option key={tone.value} value={tone.value}>{tone.label}</option>)}
    </Dropdown>
  );
}

export function LabelsManager({ slug, labels }: { slug: string; labels: LabelRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [tone, setTone] = useState<LabelTone>("NEUTRAL");
  const [edits, setEdits] = useState<Record<string, { name: string; tone: LabelTone }>>({});

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) showToast(result.error ?? "Couldn't save. Try again.", "error");
      else {
        after?.();
        showToast(success, "success");
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="New label" description="Labels tag tasks across every project in the workspace." />
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            act(() => createLabelAction(slug, { name, tone }), "Label created.", () => setName(""));
          }}
        >
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></Field>
          <Field label="Colour"><ToneSelect value={tone} onChange={setTone} label="Label colour" /></Field>
          <Button type="submit" variant="primary" loading={pending}>Add label</Button>
        </form>
      </Card>
      {labels.length === 0 ? (
        <EmptyState title="No labels yet.">Add one for bugs, ideas or hardware work.</EmptyState>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {labels.map((label) => {
              const edit = edits[label.id] ?? { name: label.name, tone: label.tone };
              const dirty = edit.name !== label.name || edit.tone !== label.tone;
              return (
                <li key={label.id} className="grid gap-3 px-5 py-3.5 sm:grid-cols-[120px_minmax(0,1fr)_170px_auto] sm:items-center">
                  <Chip tone={labelChipTone(edit.tone) as ChipTone}>{edit.name || "Label"}</Chip>
                  <Input aria-label={`Name for ${label.name}`} value={edit.name} maxLength={40} onChange={(e) => setEdits((all) => ({ ...all, [label.id]: { ...edit, name: e.target.value } }))} />
                  <ToneSelect value={edit.tone} label={`Colour for ${label.name}`} onChange={(next) => setEdits((all) => ({ ...all, [label.id]: { ...edit, tone: next } }))} />
                  <span className="flex items-center justify-end gap-2">
                    <span className="text-caption tabular-nums text-ink-muted">{label.taskCount} {label.taskCount === 1 ? "task" : "tasks"}</span>
                    {dirty ? <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => updateLabelAction(slug, { labelId: label.id, ...edit }), "Label saved.")}>Save</Button> : null}
                    <Button size="sm" variant="dangerOutline" disabled={pending} onClick={() => act(() => deleteLabelAction(slug, { labelId: label.id }), "Label deleted.")}>Delete</Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
