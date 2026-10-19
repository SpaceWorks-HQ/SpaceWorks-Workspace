"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAnnouncementAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { CheckboxField, SegmentedControl } from "@/components/ui/choice";
import { Card, Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { DestinationPicker, type PickableDestination } from "@/components/community/DestinationPicker";
import { RichTextEditor } from "@/components/community/RichTextEditor";

type PublishMode = "now" | "schedule" | "draft";

export type AnnouncementFormValues = {
  title: string;
  body: string;
  pinned: boolean;
  /** "published" announcements keep their publish time; the choice is hidden. */
  status: "new" | "draft" | "scheduled" | "published";
  scheduledFor: string;
  destinationIds: string[];
};

export function AnnouncementForm({
  slug,
  announcementId,
  initial,
  destinations,
  settingsHref,
  timeZoneLabel,
}: {
  slug: string;
  announcementId: string | null;
  initial: AnnouncementFormValues;
  destinations: PickableDestination[];
  settingsHref: string | null;
  timeZoneLabel: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [pinned, setPinned] = useState(initial.pinned);
  const [mode, setMode] = useState<PublishMode>(initial.status === "scheduled" ? "schedule" : initial.status === "draft" ? "draft" : "now");
  const [scheduledFor, setScheduledFor] = useState(initial.scheduledFor);
  const [destinationIds, setDestinationIds] = useState(initial.destinationIds);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const bodyId = useId();
  const published = initial.status === "published";

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      const result = await saveAnnouncementAction(slug, announcementId, { title, body, pinned, publish: mode, scheduledFor, destinationIds });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setErrors({});
      const message = published ? "Changes saved." : mode === "now" ? "Announcement published." : mode === "schedule" ? "Announcement scheduled." : "Draft saved.";
      showToast(message, "success");
      router.push(`/w/${slug}/announcements/${result.data!.id}`);
      router.refresh();
    });

  const submitLabel = published ? "Save changes" : mode === "now" ? "Publish now" : mode === "schedule" ? "Schedule" : "Save draft";

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {formError ? <Callout tone="danger" role="alert">{formError}</Callout> : null}
      <Card className="flex flex-col gap-5">
        <Field label="Title" error={errors.title?.[0]}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required autoFocus={!announcementId} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span aria-hidden className="text-label text-ink">Message</span>
          <RichTextEditor id={bodyId} label="Message" value={body} onChange={setBody} invalid={Boolean(errors.body)} describedBy={errors.body ? `${bodyId}-error` : undefined} />
          {errors.body ? <p id={`${bodyId}-error`} className="text-caption text-danger-fg">{errors.body[0]}</p> : null}
        </div>
        <CheckboxField label="Pin to the top" description="Pinned announcements stay above the rest until you unpin them." checked={pinned} onCheckedChange={(value) => setPinned(value === true)} />
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-title text-ink">Send to</h2>
          <p className="mt-1 text-body-ui text-ink-muted">Everyone in the workspace gets it in-app. Pick where else it should be announced.</p>
        </div>
        <DestinationPicker options={destinations} selected={destinationIds} onChange={setDestinationIds} settingsHref={settingsHref} />
      </Card>

      {published ? null : (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="text-title text-ink">When</h2>
            <p className="mt-1 text-body-ui text-ink-muted">Times are in {timeZoneLabel}.</p>
          </div>
          <SegmentedControl<PublishMode>
            ariaLabel="When to publish"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "now", label: "Publish now" },
              { value: "schedule", label: "Schedule" },
              { value: "draft", label: "Draft" },
            ]}
            className="self-start"
          />
          {mode === "schedule" ? (
            <Field label="Publish at" error={errors.scheduledFor?.[0]} className="max-w-xs">
              <Input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} required />
            </Field>
          ) : null}
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" loading={pending}>{submitLabel}</Button>
      </div>
    </form>
  );
}
