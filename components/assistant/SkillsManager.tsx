"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createSkillAction, deleteSkillAction, installBuiltinSkillsAction, updateSkillAction } from "@/app/actions/assistant";
import { Button } from "@/components/ui/button";
import { Callout, Card, Chip, EmptyState } from "@/components/ui/display";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SwitchRow } from "@/components/ui/choice";
import { useToast } from "@/components/feedback/ToastProvider";

type Skill = { id: string; name: string; description: string; body: string; enabled: boolean };
type Draft = { id: string | null; name: string; description: string; body: string; enabled: boolean };

const EMPTY: Draft = { id: null, name: "", description: "", body: "", enabled: true };

export function SkillsManager({ slug, skills, missingBuiltins }: { slug: string; skills: Skill[]; missingBuiltins: string[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [deleting, setDeleting] = useState<Skill | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        showToast(result.error ?? "Couldn't save. Try again.", "error");
      } else {
        setErrors({});
        after?.();
        showToast(success, "success");
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[640px] text-body-ui text-ink-secondary">Skills are playbooks in plain markdown. Every enabled skill is added to the assistant&apos;s instructions, so keep them short and specific.</p>
        <Button variant="primary" startIcon={<Plus />} onClick={() => { setErrors({}); setDraft(EMPTY); }}>New skill</Button>
      </div>

      {missingBuiltins.length > 0 ? (
        <Callout
          tone="info"
          title="Built-in skills are available."
          action={<Button size="sm" variant="primary" loading={pending} onClick={() => act(() => installBuiltinSkillsAction(slug), "Built-in skills added.")}>Add {missingBuiltins.length === 1 ? "it" : "them"}</Button>}
        >
          {missingBuiltins.join(", ")}.
        </Callout>
      ) : null}

      {skills.length === 0 ? (
        <EmptyState title="No skills yet.">Add the built-in ones above, or write a playbook for something your crew asks often.</EmptyState>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {skills.map((skill) => (
              <li key={skill.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-label text-ink">
                    {skill.name}
                    <Chip size="sm" tone={skill.enabled ? "success" : "outline"}>{skill.enabled ? "On" : "Off"}</Chip>
                  </p>
                  <p className="mt-0.5 text-caption text-ink-muted">{skill.description}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setErrors({}); setDraft({ ...skill }); }}>Edit</Button>
                  <Button size="sm" variant="dangerOutline" onClick={() => setDeleting(skill)}>Delete…</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent size="md">
          <DialogHeader title={draft?.id ? "Edit skill" : "New skill"} description="Say when it applies, then write the steps the assistant should follow." />
          {draft ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                const payload = { name: draft.name, description: draft.description, body: draft.body, enabled: draft.enabled };
                act(
                  () => (draft.id ? updateSkillAction(slug, { ...payload, skillId: draft.id }) : createSkillAction(slug, payload)),
                  draft.id ? "Skill saved." : "Skill added.",
                  () => setDraft(null),
                );
              }}
            >
              <DialogBody className="flex flex-col gap-4">
                <Field label="Name" error={errors.name?.[0]}><Input value={draft.name} maxLength={80} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
                <Field label="When to use it" error={errors.description?.[0]}><Input value={draft.description} maxLength={200} required onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
                <Field label="Playbook" helperText="Markdown. Steps, rules and the shape of a good answer." error={errors.body?.[0]}>
                  <Textarea rows={10} value={draft.body} maxLength={8000} required onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                </Field>
                <SwitchRow label="Enabled" description="Only enabled skills reach the assistant." checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} />
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" variant="primary" loading={pending}>{draft.id ? "Save skill" : "Add skill"}</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete the ${deleting?.name ?? ""} skill?`}
        message="The assistant stops using it right away."
        confirmLabel="Delete skill"
        loading={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && act(() => deleteSkillAction(slug, { skillId: deleting.id }), "Skill deleted.", () => setDeleting(null))}
      />
    </div>
  );
}
