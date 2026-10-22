"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import {
  saveHandlerAppointment,
  saveSafeguardingCase,
  saveSafeguardingEvent,
  changeSafeguardingCase,
  finishSafeguardingAction,
} from "@/app/actions/govextras";
import { caseKinds, caseStatuses } from "@/lib/govextras/rules";
import { label } from "@/lib/governance/schemas";
export type CaseChoice = { id: string; name: string };
export function CaseForm({
  slug,
  mode,
  id,
  people,
  committees = [],
  defaults,
}: {
  slug: string;
  mode: "appointment" | "create" | "event" | "update";
  id?: string;
  people: CaseChoice[];
  committees?: CaseChoice[];
  defaults?: { status: string; dueOn: string; handlerIds: string[] };
}) {
  const [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  const router = useRouter();
  const select = (
    name: string,
    title: string,
    options: Array<{ id: string; name: string }>,
    value?: string,
  ) => (
    <Field label={title}>
      <Dropdown name={name} defaultValue={value} required={name !== "ownerId"}>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Dropdown>
    </Field>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          values = Object.fromEntries(f),
          form = e.currentTarget;
        start(async () => {
          try {
            const r =
              mode === "appointment"
                ? await saveHandlerAppointment(slug, {
                    ...values,
                    revoke: f.has("revoke"),
                  })
                : mode === "create"
                  ? await saveSafeguardingCase(slug, {
                      ...values,
                      handlerIds: f.getAll("handlerIds"),
                    })
                  : mode === "event"
                    ? await saveSafeguardingEvent(slug, {
                        ...values,
                        caseId: id,
                      })
                    : await changeSafeguardingCase(slug, {
                        ...values,
                        caseId: id,
                        handlerIds: f.getAll("handlerIds"),
                      });
            setMessage(r.ok ? "Saved." : r.error);
            if (r.ok) {
              if (mode === "create" && r.data && "id" in r.data)
                router.push(`?edit=${r.data.id}`);
              if (mode === "event") form.reset();
              router.refresh();
            }
          } catch {
            setMessage("Couldn't save. Try again.");
          }
        });
      }}
    >
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">{label(mode)} case record</legend>
        {mode === "appointment" ? (
          <>
            {select("userId", "Committee member", people)}
            {select(
              "committeeId",
              "Internal Committee / safeguarding committee",
              committees,
            )}
            <Field label="Appointment valid until">
              <Input type="date" name="endsOn" required />
            </Field>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" name="revoke" />
              Revoke this member’s appointment
            </label>
            <p className="text-ink-muted sm:col-span-2">
              Record an approved committee appointment. An appointment alone
              does not reveal cases; handlers must also be assigned to each
              case.
            </p>
          </>
        ) : null}
        {mode === "create" ? (
          <>
            {select(
              "kind",
              "Case type",
              caseKinds.map((id) => ({ id, name: label(id) })),
            )}
            <Field label="Received on">
              <Input type="date" name="receivedOn" required />
            </Field>
            <Field label="Next review / action due">
              <Input type="date" name="dueOn" required />
            </Field>
            <Field
              label="Restricted concern and initial response"
              className="sm:col-span-2"
            >
              <Textarea name="details" required maxLength={20000} />
            </Field>
          </>
        ) : null}
        {mode === "create" || mode === "update" ? (
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-label">
              Designated case handlers (include yourself)
            </legend>
            {people.map((p) => (
              <label key={p.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  name="handlerIds"
                  value={p.id}
                  defaultChecked={defaults?.handlerIds.includes(p.id)}
                />
                {p.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        {mode === "update" ? (
          <>
            {select(
              "status",
              "Case status",
              caseStatuses.map((id) => ({ id, name: label(id) })),
              defaults?.status,
            )}
            <Field label="Next review / action due">
              <Input
                type="date"
                name="dueOn"
                required
                defaultValue={defaults?.dueOn}
              />
            </Field>
          </>
        ) : null}
        {mode === "event" ? (
          <>
            {select(
              "kind",
              "Timeline entry",
              ["NOTE", "ACTION", "OUTCOME"].map((id) => ({
                id,
                name: label(id),
              })),
            )}
            {select("ownerId", "Action owner (for actions)", [
              { id: "", name: "Not an action" },
              ...people,
            ])}
            <Field label="Action due date (for actions)">
              <Input name="dueOn" type="date" />
            </Field>
            <Field
              label="Restricted note, action or outcome"
              className="sm:col-span-2"
            >
              <Textarea name="body" required maxLength={20000} />
            </Field>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending
              ? "Saving"
              : mode === "create"
                ? "Record case"
                : mode === "appointment"
                  ? "Save appointment"
                  : mode === "event"
                    ? "Add timeline entry"
                    : "Save case status and handlers"}
          </Button>
        </div>
      </fieldset>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
export function CompleteAction({
  slug,
  caseId,
  eventId,
}: {
  slug: string;
  caseId: string;
  eventId: string;
}) {
  const [pending, start] = useTransition(),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await finishSafeguardingAction(slug, caseId, eventId);
              setMessage(r.ok ? "Action completed." : r.error);
              router.refresh();
            } catch {
              setMessage("Couldn't save. Try again.");
            }
          })
        }
      >
        Mark action complete
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
