"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCalendarEntryAction,
  attachCalendarFileAction,
} from "@/app/actions/calendar";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { Field, Input, Dropdown, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import type { CalendarData } from "./CalendarScreen";
type Props = {
  slug: string;
  zone: string;
  date: string;
  data: CalendarData;
  entry?: CalendarData["entries"][number];
  canDeadline: boolean;
  onClose: () => void;
};
export function EntryForm(p: Props) {
  const entry = p.entry,
    zone = entry?.timezone ?? p.zone,
    router = useRouter();
  const [savedId, setSavedId] = useState<string | undefined>(entry?.id);
  const [pending, start] = useTransition(),
    [error, setError] = useState(""),
    [kind, setKind] = useState(entry?.kind ?? "REMINDER"),
    [repeat, setRepeat] = useState("NONE"),
    [files, setFiles] = useState<File[]>([]),
    [preview, setPreview] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) p.onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader
          title={entry ? "Edit calendar entry" : "Add a date"}
          description={`Times in ${zone}. Reminders stay private.`}
        />
        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const local = String(f.get("startsAt")),
                startsAt = zonedInputToIso(local, zone),
                until = zonedInputToIso(
                  `${f.get("until") || local.slice(0, 10)}T23:59`,
                  zone,
                );
              if (!startsAt || !until) {
                setError("Choose a valid local time.");
                return;
              }
              setError("");
              start(async () => {
                try {
                  const r = await saveCalendarEntryAction(p.slug, {
                    id: savedId,
                    title: f.get("title"),
                    kind,
                    startsAt,
                    until,
                    timezone: zone,
                    repeat,
                    notes: f.get("notes"),
                    teamId: f.get("teamId") || null,
                    projectId: f.get("projectId") || null,
                    visibility:
                      kind === "REMINDER" ? "PRIVATE" : f.get("visibility"),
                    reminderMinutes: f.get("reminderMinutes"),
                  });
                  if (!r.ok) {
                    setError(r.error);
                    return;
                  }
                  setSavedId(r.data?.id);
                  for (const file of files) {
                    const form = new FormData();
                    form.set("file", file);
                    const upload = await attachCalendarFileAction(
                      p.slug,
                      r.data!.id,
                      form,
                    );
                    if (!upload.ok) {
                      setError(`Date saved. ${upload.error}`);
                      router.refresh();
                      setFiles([]);
                      return;
                    }
                  }
                  router.refresh();
                  p.onClose();
                } catch {
                  setError("Couldn't save. Try again.");
                }
              });
            }}
          >
            {error && (
              <Callout role="alert" tone="danger">
                {error}
              </Callout>
            )}
            <Field label="Kind">
              <Dropdown
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                disabled={!!entry}
              >
                <option value="REMINDER">Personal reminder</option>
                {p.canDeadline && (
                  <option value="DEADLINE">Compliance / filing deadline</option>
                )}
              </Dropdown>
            </Field>
            <Field label="Title" required>
              <Input name="title" defaultValue={entry?.title} maxLength={200} />
            </Field>
            <Field label="Date and time" required>
              <Input
                name="startsAt"
                type="datetime-local"
                defaultValue={
                  entry
                    ? zonedDatetimeLocalValue(new Date(entry.startsAt), zone)
                    : `${p.date}T10:00`
                }
              />
            </Field>
            {!entry && (
              <>
                <Field label="Repeat">
                  <Dropdown
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                  >
                    <option value="NONE">Does not repeat</option>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="BIWEEKLY">Every two weeks</option>
                    <option value="MONTHLY">Monthly</option>
                  </Dropdown>
                </Field>
                {repeat !== "NONE" && (
                  <Field
                    label="Repeat through"
                    required
                    helperText="Up to 100 occurrences within one year. Files attach to the first occurrence."
                  >
                    <Input name="until" type="date" />
                  </Field>
                )}
              </>
            )}
            {kind === "DEADLINE" && (
              <>
                <Field label="Audience">
                  <Dropdown
                    name="visibility"
                    defaultValue={entry?.visibility ?? "PRIVATE"}
                  >
                    <option value="PRIVATE">Only me</option>
                    <option value="TEAM">Team</option>
                    <option value="WORKSPACE">Workspace</option>
                  </Dropdown>
                </Field>
                <Field label="Team" optional>
                  <Dropdown name="teamId" defaultValue={entry?.teamId ?? ""}>
                    <option value="">No team</option>
                    {p.data.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label="Project" optional>
                  <Dropdown
                    name="projectId"
                    defaultValue={entry?.projectId ?? ""}
                  >
                    <option value="">No project</option>
                    {p.data.projects.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Dropdown>
                </Field>
              </>
            )}
            <Field label="Notes" optional>
              <Textarea name="notes" defaultValue={entry?.notes ?? ""} />
            </Field>
            <Field label="Remind me before (minutes)">
              <Input
                name="reminderMinutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={entry?.reminderMinutes ?? 30}
              />
            </Field>
            <div
              className="space-y-3 rounded-lg border border-dashed border-line-strong p-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setFiles(
                  [...files, ...Array.from(e.dataTransfer.files)].slice(0, 20),
                );
              }}
            >
              <Field
                label="Files"
                optional
                helperText="Drop images or PDFs here, or choose files. Up to 20 files per record; 25 MB per file unless your instance sets a lower limit."
              >
                <Input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              </Field>
              <Field label="Take a photo" optional>
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  onChange={(e) =>
                    setFiles(
                      [...files, ...Array.from(e.target.files ?? [])].slice(
                        0,
                        20,
                      ),
                    )
                  }
                />
              </Field>
              <ul>
                {files.map((file, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="break-all text-caption">{file.name}</span>
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() =>
                        setFiles(files.filter((_, index) => index !== i))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            {entry?.fileIds.length ? (
              <div className="space-y-2">
                <h3 className="text-label">Attached files</h3>
                {entry.fileIds.map((id, i) => (
                  <div key={id} className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => setPreview(id)}
                    >
                      Preview file {i + 1}
                    </Button>
                    <a
                      href={`/api/files/${id}?download=1`}
                      className="inline-flex min-h-11 items-center text-accent-text underline"
                    >
                      Download file {i + 1}
                    </a>
                  </div>
                ))}
              </div>
            ) : null}
            {preview && (
              <div>
                <a
                  href={`/api/files/${preview}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center text-accent-text underline"
                >
                  Open image or PDF preview
                </a>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setPreview(null)}
                >
                  Close preview
                </Button>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pb-3">
              <Button type="button" variant="secondary" onClick={p.onClose}>
                Close
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving" : "Save date"}
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
