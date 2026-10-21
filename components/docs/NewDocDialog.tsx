"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDocAction } from "@/app/actions/docs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { RadioGroup, Radio } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";

export type TemplateOption = { id: string; name: string; description: string };

/** Start a blank page or one from a template (built-in or the workspace's own). */
export function NewDocDialog({ slug, open, parentId, parentTitle, templates, onOpenChange }: { slug: string; open: boolean; parentId: string | null; parentTitle: string | null; templates: TemplateOption[]; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("blank");
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setTitle("");
      setTemplate("blank");
      setError(null);
    }
    onOpenChange(next);
  };

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await createDocAction(slug, { parentId, title: title.trim() || null, templateId: template === "blank" ? null : template });
      if (!result.ok || !result.data) {
        setError(result.ok ? "Couldn't create the page. Try again." : result.error);
        return;
      }
      showToast("Page created.", "success");
      setTitle("");
      setTemplate("blank");
      onOpenChange(false);
      router.push(`/w/${slug}/docs/${result.data.id}`);
    });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md">
        <DialogHeader title={parentTitle ? `New page in ${parentTitle}` : "New page"} description="Start blank or from a template. You can change everything later." />
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <DialogBody className="flex flex-col gap-5">
            <Field label="Title" optional helperText="Leave it empty to use the template's title." error={error ?? undefined}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus placeholder="Laser cutter guide" />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-label text-ink">Start from</legend>
              <RadioGroup value={template} onValueChange={setTemplate} aria-label="Start from" className="grid gap-3 sm:grid-cols-2">
                <Radio value="blank" label="Blank page" description="An empty page." />
                {templates.map((option) => (
                  <Radio key={option.id} value={option.id} label={option.name} description={option.description || undefined} />
                ))}
              </RadioGroup>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => close(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending} loadingLabel="Creating">Create page</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
