"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEventAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout, Card } from "@/components/ui/display";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import { EVENT_KIND_LABELS, EVENT_KINDS } from "@/lib/community/validation";

export type EventFormValues = {
  title: string;
  kind: (typeof EVENT_KINDS)[number];
  startsAt: string;
  endsAt: string;
  location: string;
  description: string;
  capacity: string;
};

/** Create or edit a community event. Times are datetime-local values in the workspace zone. */
export function EventForm({ slug, eventId, initial, timeZoneLabel }: { slug: string; eventId: string | null; initial: EventFormValues; timeZoneLabel: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      const capacity = values.capacity.trim() === "" ? null : Number(values.capacity);
      if (capacity !== null && !Number.isFinite(capacity)) {
        setErrors({ capacity: ["Use a whole number of spots, or leave it empty."] });
        return;
      }
      const result = await saveEventAction(slug, eventId, { ...values, capacity });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setErrors({});
      showToast(eventId ? "Event updated." : "Event added to the calendar.", "success");
      router.push(`/w/${slug}/calendar/${result.data!.id}`);
      router.refresh();
    });

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
        <Field label="Name" error={errors.title?.[0]}>
          <Input value={values.title} onChange={(event) => set("title", event.target.value)} maxLength={120} placeholder="Saturday build night" required autoFocus={!eventId} />
        </Field>
        <Field label="Type" error={errors.kind?.[0]} className="sm:max-w-xs">
          <Dropdown value={values.kind} onChange={(event) => set("kind", event.target.value as EventFormValues["kind"])}>
            {EVENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {EVENT_KIND_LABELS[kind]}
              </option>
            ))}
          </Dropdown>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" error={errors.startsAt?.[0]} helperText={timeZoneLabel}>
            <Input type="datetime-local" value={values.startsAt} onChange={(event) => set("startsAt", event.target.value)} required />
          </Field>
          <Field label="Ends" optional error={errors.endsAt?.[0]} helperText="Leave empty for a two-hour slot.">
            <Input type="datetime-local" value={values.endsAt} min={values.startsAt || undefined} onChange={(event) => set("endsAt", event.target.value)} />
          </Field>
        </div>
        <Field label="Where" optional error={errors.location?.[0]}>
          <Input value={values.location} onChange={(event) => set("location", event.target.value)} maxLength={200} placeholder="The workshop, first floor" />
        </Field>
        <Field label="Details" optional error={errors.description?.[0]}>
          <Textarea value={values.description} onChange={(event) => set("description", event.target.value)} maxLength={4000} rows={5} placeholder="What to bring, who it's for, what we'll build." />
        </Field>
        <Field label="Spots" optional error={errors.capacity?.[0]} helperText="When it fills up, new replies join a waitlist and move up as spots free." className="sm:max-w-xs">
          <Input type="number" inputMode="numeric" min={1} max={10000} step={1} value={values.capacity} onChange={(event) => set("capacity", event.target.value)} placeholder="No limit" />
        </Field>
      </Card>
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" loading={pending}>{eventId ? "Save changes" : "Add to calendar"}</Button>
      </div>
    </form>
  );
}
