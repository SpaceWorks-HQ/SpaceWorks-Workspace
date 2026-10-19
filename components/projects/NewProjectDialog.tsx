"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createProjectAction } from "@/app/actions/projects";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import { COLUMN_TEMPLATES, suggestProjectKey, type ColumnTemplateKey } from "@/lib/projects/keys";

/** "New project": name, key (suggested from the name), board template, optional team and dates. */
export function NewProjectDialog({ slug, teams, label = "New project" }: { slug: string; teams: Array<{ id: string; name: string }>; label?: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<ColumnTemplateKey>("standard");
  const [teamId, setTeamId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setKey("");
    setKeyTouched(false);
    setDescription("");
    setTemplate("standard");
    setTeamId("");
    setDueOn("");
    setErrors({});
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" startIcon={<Plus />}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader title="Start a project" description="Give the build a name and a short key. Tasks get numbers like BOT-12." />
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const result = await createProjectAction(slug, { name, key, description, template, teamId: teamId || null, dueOn: dueOn || null });
            setBusy(false);
            if (!result.ok) {
              setErrors(result.fieldErrors ?? {});
              showToast(result.error, "error");
              return;
            }
            showToast(`${name} is ready. Add the first tasks.`, "success");
            setOpen(false);
            reset();
            router.push(`/w/${slug}/projects/${result.data!.key}`);
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" error={errors.name?.[0]}>
              <Input
                value={name}
                autoFocus
                maxLength={80}
                required
                placeholder="Line-follower robot"
                onChange={(event) => {
                  setName(event.target.value);
                  if (!keyTouched) setKey(event.target.value.trim() ? suggestProjectKey(event.target.value) : "");
                }}
              />
            </Field>
            <Field label="Key" helperText="2–10 capital letters or numbers. Used in task references." error={errors.key?.[0]}>
              <Input
                value={key}
                required
                maxLength={10}
                autoCapitalize="characters"
                className="uppercase tabular-nums"
                onChange={(event) => {
                  setKeyTouched(true);
                  setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                }}
              />
            </Field>
            <Field label="Description" optional error={errors.description?.[0]}>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="What are we building, and for whom?" />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-label text-ink">Board columns</legend>
              <RadioGroup value={template} onValueChange={(value) => setTemplate(value as ColumnTemplateKey)} className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(COLUMN_TEMPLATES) as ColumnTemplateKey[]).map((option) => (
                  <RadioCard key={option} value={option} label={COLUMN_TEMPLATES[option].label} description={COLUMN_TEMPLATES[option].description} />
                ))}
              </RadioGroup>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              {teams.length ? (
                <Field label="Team" optional helperText="Private teams keep their projects to themselves." error={errors.teamId?.[0]}>
                  <Dropdown value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                    <option value="">Whole workspace</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </Dropdown>
                </Field>
              ) : null}
              <Field label="Target date" optional error={errors.dueOn?.[0]}>
                <Input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !key}>
              Start project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
