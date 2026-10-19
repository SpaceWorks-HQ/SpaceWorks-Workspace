"use client";

import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import { setRecurrenceAction, skipNextOccurrenceAction, stopRecurrenceAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Radio, RadioGroup } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatDayShort } from "@/lib/format/datetime";
import { fromDateInputValue, toDateInputValue } from "@/lib/tasks/localDate";
import { describeRule, formatRRule, parseRRule, presetRule, WEEKDAYS, type Frequency, type RecurrenceRule, type RepeatPreset, type Weekday } from "@/lib/tasks/recurrence";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import { MultiSelect } from "./MultiSelect";
import type { RunAction } from "./useTaskRunner";

const WEEKDAY_SHORT: Record<Weekday, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const UNITS: Record<Frequency, string> = { DAILY: "days", WEEKLY: "weeks", MONTHLY: "months", YEARLY: "years" };

type Choice = RepeatPreset | "custom";

function matchPreset(rule: RecurrenceRule, anchor: Date, timeZone: string): Choice {
  const presets: RepeatPreset[] = ["daily", "weekdays", "weekly", "fortnightly", "monthly", "yearly"];
  return presets.find((preset) => formatRRule(presetRule(preset, anchor, timeZone)) === formatRRule(rule)) ?? "custom";
}

/** The repeat control in the task editor: summary plus a dialog to set, change, skip or stop the schedule. */
export function RepeatControl({ slug, task, run }: { slug: string; task: TaskDetailDTO; run: RunAction }) {
  const timeZone = task.timeZone;
  const current = task.recurrence;
  const canEdit = task.permissions.canEdit && !task.archivedAt;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const initialRule = (current?.active ? parseRRule(current.rrule) : null) ?? null;
  const [startDate, setStartDate] = useState("");
  const anchor = useMemo(() => (startDate ? fromDateInputValue(startDate, timeZone) : null) ?? new Date(), [startDate, timeZone]);
  const [choice, setChoice] = useState<Choice>(() => (initialRule ? matchPreset(initialRule, new Date(), timeZone) : "weekly"));
  const [custom, setCustom] = useState<RecurrenceRule>(() => initialRule ?? { freq: "WEEKLY", interval: 1, byDay: ["MO"] });
  const [mode, setMode] = useState<"ON_SCHEDULE" | "ON_COMPLETION">(current?.createMode ?? "ON_SCHEDULE");
  const [assigneeMode, setAssigneeMode] = useState<"FIXED" | "ROTATE">(current?.assigneeMode ?? "FIXED");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(current?.assigneeIds ?? task.assignees.map((person) => person.id));
  const [offset, setOffset] = useState(String(current?.dueOffsetDays ?? 0));

  const rule: RecurrenceRule = choice === "custom" ? custom : presetRule(choice, anchor, timeZone);
  const preview = describeRule(rule);
  const people = task.members;

  const save = async () => {
    setBusy(true);
    const ok = await run(
      () =>
        setRecurrenceAction(slug, {
          taskId: task.id,
          rrule: formatRRule(rule),
          createMode: mode,
          assigneeMode,
          assigneeIds,
          dueOffsetDays: Math.max(0, Math.min(365, Number.parseInt(offset, 10) || 0)),
          startDate: startDate || null,
        }),
      (data) => {
        const what = data ? `${data.description.charAt(0).toLowerCase()}${data.description.slice(1)}` : "";
        return data?.nextRunAt ? `Repeats ${what}. Next one ${formatDayShort(data.nextRunAt, timeZone)}.` : `Repeats ${what}.`;
      },
    );
    setBusy(false);
    if (ok) setOpen(false);
  };

  const active = current?.active;
  return (
    <div className="flex flex-col gap-1.5">
      {active ? (
        <p className="flex items-start gap-1.5 text-body-ui text-ink">
          <Repeat aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" />
          <span>
            {current.description}
            {current.createMode === "ON_COMPLETION" ? ", after each one is done" : ""}
            {current.nextRunAt && current.createMode === "ON_SCHEDULE" ? <span className="block text-caption text-ink-muted">Next one {formatDayShort(current.nextRunAt, timeZone)}</span> : null}
            {!current.isTemplate ? <span className="block text-caption text-ink-muted">Created by a repeat schedule</span> : null}
          </span>
        </p>
      ) : (
        <p className="text-body-ui text-ink-muted">Doesn&apos;t repeat</p>
      )}
      {canEdit ? (
        <div className="flex flex-wrap gap-x-1">
          <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
            {active ? "Change repeat" : "Set up repeat"}
          </Button>
          {active && current.createMode === "ON_SCHEDULE" && current.nextRunAt ? (
            <Button variant="quiet" size="sm" onClick={() => void run(() => skipNextOccurrenceAction(slug, { taskId: task.id }), (data) => (data?.nextRunAt ? `Skipped. Next one ${formatDayShort(data.nextRunAt, timeZone)}.` : "Skipped."))}>
              Skip next
            </Button>
          ) : null}
          {active ? (
            <Button variant="dangerQuiet" size="sm" onClick={() => void run(() => stopRecurrenceAction(slug, { taskId: task.id }), "Stopped repeating.")}>
              Stop repeating
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader title="Repeat this task" description="A fresh copy is created on schedule with the same title, description, priority and labels." />
          <DialogBody className="flex flex-col gap-5">
            <Field label="How often">
              <Dropdown value={choice} onChange={(event) => setChoice(event.target.value as Choice)}>
                <option value="daily">Every day</option>
                <option value="weekdays">Every weekday</option>
                <option value="weekly">{describeRule(presetRule("weekly", anchor, timeZone))}</option>
                <option value="fortnightly">{describeRule(presetRule("fortnightly", anchor, timeZone))}</option>
                <option value="monthly">{describeRule(presetRule("monthly", anchor, timeZone))}</option>
                <option value="yearly">Every year</option>
                <option value="custom">Custom</option>
              </Dropdown>
            </Field>
            {choice === "custom" ? (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                <div className="grid grid-cols-[96px_minmax(0,1fr)] items-end gap-3">
                  <Field label="Every">
                    <Input type="number" min={1} max={365} inputMode="numeric" value={custom.interval} onChange={(event) => setCustom({ ...custom, interval: Math.max(1, Math.min(365, Number(event.target.value) || 1)) })} />
                  </Field>
                  <Field label="Unit" hideLabel>
                    <Dropdown
                      value={custom.freq}
                      onChange={(event) => {
                        const freq = event.target.value as Frequency;
                        const parts = toDateInputValue(anchor, timeZone);
                        setCustom({
                          freq,
                          interval: custom.interval,
                          ...(freq === "WEEKLY" ? { byDay: custom.byDay?.length ? custom.byDay : (presetRule("weekly", anchor, timeZone).byDay ?? ["MO"]) } : {}),
                          ...(freq === "MONTHLY" ? { byMonthDay: Number(parts.slice(8, 10)) || 1 } : {}),
                        });
                      }}
                    >
                      {(Object.keys(UNITS) as Frequency[]).map((freq) => (
                        <option key={freq} value={freq}>
                          {UNITS[freq]}
                        </option>
                      ))}
                    </Dropdown>
                  </Field>
                </div>
                {custom.freq === "WEEKLY" ? (
                  <fieldset>
                    <legend className="mb-1.5 text-label text-ink">On</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((day) => {
                        const on = custom.byDay?.includes(day) ?? false;
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              const next = on ? (custom.byDay ?? []).filter((value) => value !== day) : [...(custom.byDay ?? []), day];
                              if (next.length) setCustom({ ...custom, byDay: WEEKDAYS.filter((value) => next.includes(value)) });
                            }}
                            className={cn("min-h-11 min-w-12 rounded-md border px-2 text-sm font-semibold transition-colors duration-[120ms]", on ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-panel text-ink hover:bg-muted")}
                          >
                            {WEEKDAY_SHORT[day]}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}
                {custom.freq === "MONTHLY" ? (
                  <Field label="On day">
                    <Dropdown value={String(custom.byMonthDay ?? 1)} onChange={(event) => setCustom({ ...custom, byMonthDay: Number(event.target.value) })}>
                      {Array.from({ length: 31 }, (_, index) => (
                        <option key={index + 1} value={String(index + 1)}>
                          {String(index + 1)}
                        </option>
                      ))}
                      <option value="-1">Last day of the month</option>
                    </Dropdown>
                  </Field>
                ) : null}
              </div>
            ) : null}
            {choice === "custom" ? (
              <p className="text-body-ui text-ink-secondary" aria-live="polite">
                {preview}.
              </p>
            ) : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-label text-ink">When to create the next one</legend>
              <RadioGroup value={mode} onValueChange={(value) => setMode(value as typeof mode)} className="flex flex-col gap-2">
                <Radio value="ON_SCHEDULE" label="On a schedule" description="Created on each matching day, whether or not the last one is done." />
                <Radio value="ON_COMPLETION" label="After the current one is done" description="The next one is due on the next matching day after it's finished." />
              </RadioGroup>
            </fieldset>
            {mode === "ON_SCHEDULE" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start on" optional helperText="Leave empty to start from tomorrow.">
                  <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </Field>
                <Field label="Due" helperText="Days after it's created. 0 means the same day.">
                  <Input type="number" min={0} max={365} inputMode="numeric" value={offset} onChange={(event) => setOffset(event.target.value)} />
                </Field>
              </div>
            ) : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-label text-ink">Who gets it</legend>
              <RadioGroup value={assigneeMode} onValueChange={(value) => setAssigneeMode(value as typeof assigneeMode)} className="flex flex-col gap-2">
                <Radio value="FIXED" label="The same people every time" />
                <Radio value="ROTATE" label="Take turns" description="One person per copy, in the order picked." />
              </RadioGroup>
              <MultiSelect
                title="People"
                trigger={
                  <Button variant="secondary" size="sm" className="self-start">
                    {assigneeIds.length ? `${assigneeIds.length} ${assigneeIds.length === 1 ? "person" : "people"}` : "Pick people"}
                  </Button>
                }
                items={people.map((person) => ({ id: person.id, label: person.name ?? "Member", leading: <Avatar name={person.name} src={person.image} size="xs" /> }))}
                selected={assigneeIds}
                onChange={setAssigneeIds}
                searchPlaceholder="Find a member"
              />
              {assigneeIds.length ? (
                <p className="text-caption text-ink-muted">
                  {assigneeIds.map((id) => people.find((person) => person.id === id)?.name ?? "Former member").join(assigneeMode === "ROTATE" ? " → " : ", ")}
                </p>
              ) : null}
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={busy}>
              Save repeat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
