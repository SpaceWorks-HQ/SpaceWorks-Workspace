"use client";

import { useMemo } from "react";
import { LAYERS, type Layer } from "@/lib/calendar/algorithms";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import { formatDate, formatDayShort, formatTimeRange } from "@/lib/format/datetime";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState } from "@/components/ui/display";
import { moveCalendarTaskAction } from "@/app/actions/calendar";
import type { CalendarItem, CalendarScreenProps, CalendarMutationRunner, CalendarNavigate } from "./CalendarTypes";

const tones: Record<Layer, string> = {
  meeting: "bg-accent-soft text-accent-text",
  task: "bg-info-bg text-info-fg",
  availability: "bg-surface text-ink",
  shift: "bg-success-bg text-success-fg",
  cycle: "bg-warning-bg text-warning-fg",
  renewal: "bg-warning-bg text-warning-fg",
  rotation: "bg-surface text-ink",
  maintenance: "bg-info-bg text-info-fg",
  deadline: "bg-warning-bg text-warning-fg",
  reminder: "bg-accent-soft text-accent-text",
  google: "bg-surface text-ink",
};

export function CalendarViews({
  p,
  guest,
  items,
  setMeetingForm,
  setEntryForm,
  setTaskNumber,
  open,
  run,
  navigate,
}: {
  p: CalendarScreenProps;
  guest: boolean;
  items: CalendarItem[];
  setMeetingForm: (open: boolean) => void;
  setEntryForm: (open: boolean) => void;
  setTaskNumber: (number: number) => void;
  open: (item: CalendarItem) => void;
  run: CalendarMutationRunner;
  navigate: CalendarNavigate;
}) {
  const days = useMemo(
    () =>
      Array.from({ length: p.dayCount }, (_, i) => {
        const d = new Date(`${p.firstDay}T12:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
      }),
    [p.firstDay, p.dayCount],
  );
  const dayItems = (day: string) =>
    items.filter(
      (i) =>
        zonedDatetimeLocalValue(new Date(i.start), p.zone).slice(0, 10) <=
          day &&
        zonedDatetimeLocalValue(
          new Date(Math.max(Date.parse(i.start), Date.parse(i.end) - 1)),
          p.zone,
        ).slice(0, 10) >= day,
    );
  const event = (item: CalendarItem) => (
    <button
      key={item.id}
      type="button"
      draggable={item.layer === "task" && item.editable}
      onDragStart={(e) =>
        e.dataTransfer.setData(
          "text/plain",
          item.layer === "task" ? item.sourceId : "",
        )
      }
      onClick={() => open(item)}
      className={`my-1 flex min-h-11 w-full flex-col gap-1 rounded-md border border-line p-2 text-left text-caption ${tones[item.layer]}`}
      aria-label={`${LAYERS[item.layer]} · ${item.title} · ${formatTimeRange(item.start, item.end, p.zone)}`}
    >
      <span className="font-semibold">
        {LAYERS[item.layer]}
        {item.status
          ? ` · ${item.status.toLowerCase().replaceAll("_", " ")}`
          : ""}
      </span>
      <span className="break-words">{item.title}</span>
      {p.view !== "month" && (
        <span>
          {formatTimeRange(item.start, item.end, p.zone, { withZone: false })}
        </span>
      )}
      {item.avatars?.length ? (
        <span className="flex flex-wrap gap-1">
          {item.avatars.map((a, i) => (
            <Avatar key={i} name={a.name} src={a.image} size="xs" />
          ))}
        </span>
      ) : null}
    </button>
  );
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
      <section
        aria-label={`${p.view} calendar in ${p.zone}`}
        className="min-w-0"
      >
        {!items.length && (
          <EmptyState
            patch
            title="No dates here yet. Plan your next team meeting."
            action={
              !guest ? (
                <Button onClick={() => setMeetingForm(true)}>
                  Schedule meeting
                </Button>
              ) : (
                <Button onClick={() => setEntryForm(true)}>
                  Add reminder
                </Button>
              )
            }
          />
        )}
        <div className={p.view === "agenda" ? "hidden" : "hidden md:block"}>
          <div
            className="space-y-px overflow-hidden rounded-xl border border-line bg-line"
            role="grid"
            aria-label="Calendar dates"
            onKeyDown={(e) => {
              const delta = (
                {
                  ArrowRight: 1,
                  ArrowLeft: -1,
                  ArrowDown: 7,
                  ArrowUp: -7,
                } as Record<string, number>
              )[e.key];
              if (delta) {
                const cells = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button[data-day]",
                  ),
                );
                const index = cells.indexOf(e.target as HTMLButtonElement);
                if (index >= 0) {
                  e.preventDefault();
                  cells[
                    Math.max(0, Math.min(cells.length - 1, index + delta))
                  ]?.focus();
                }
              }
            }}
          >
            {Array.from(
              { length: Math.ceil(days.length / (p.view === "day" ? 1 : 7)) },
              (_, row) => (
                <div
                  key={row}
                  role="row"
                  className={`grid gap-px ${p.view === "day" ? "grid-cols-1" : "grid-cols-7"}`}
                >
                  {days
                    .slice(
                      row * (p.view === "day" ? 1 : 7),
                      (row + 1) * (p.view === "day" ? 1 : 7),
                    )
                    .map((day, column) => (
                      <div
                        role="gridcell"
                        key={day}
                        className="min-h-32 min-w-0 bg-panel p-1"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const taskId = e.dataTransfer.getData("text/plain");
                          if (
                            p.data.items.some(
                              (i) =>
                                i.sourceId === taskId &&
                                i.layer === "task" &&
                                i.editable,
                            )
                          ) {
                            const instant = zonedInputToIso(
                              `${day}T12:00`,
                              p.zone,
                            );
                            const dueDate = zonedDatetimeLocalValue(
                              new Date(instant!),
                              p.workspaceZone,
                            ).slice(0, 10);
                            run(
                              () =>
                                moveCalendarTaskAction(p.slug, {
                                  taskId,
                                  dueDate,
                                }),
                              "Task due date moved.",
                            );
                          }
                        }}
                      >
                        <button
                          data-day={day}
                          tabIndex={row === 0 && column === 0 ? 0 : -1}
                          className="min-h-11 w-full rounded-md text-caption text-ink-secondary hover:bg-surface"
                          onClick={() => navigate(day, "day")}
                          aria-label={`Open ${formatDate(`${day}T12:00Z`, "UTC")}`}
                        >
                          {formatDayShort(`${day}T12:00Z`, "UTC")}
                        </button>
                        {dayItems(day).map(event)}
                      </div>
                    ))}
                </div>
              ),
            )}
          </div>
          <p className="mt-2 text-caption text-ink-muted">
            Use arrow keys on date headings. Drag a task to another date, or
            open it to change its due date with the keyboard. Task dates are
            saved in {p.workspaceZone}.
          </p>
        </div>
        <div
          className={
            p.view === "agenda" ? "space-y-4" : "space-y-4 md:hidden"
          }
        >
          {days
            .filter((d) => dayItems(d).length)
            .map((day) => (
              <Card key={day}>
                <h2 className="text-label">
                  {formatDate(`${day}T12:00Z`, "UTC")}
                </h2>
                {dayItems(day).map(event)}
              </Card>
            ))}
        </div>
      </section>
      <aside>
        <Card>
          <h2 className="text-title">Assigned to me this week</h2>
          <p className="mt-1 text-caption text-ink-muted">
            {p.workspaceZone}
          </p>
          {p.assigned.length ? (
            <ul className="mt-3 divide-y divide-line">
              {p.assigned.map((t) => (
                <li key={t.id}>
                  <button
                    className="min-h-11 py-3 text-left text-accent-text"
                    onClick={() => setTaskNumber(t.number)}
                  >
                    {t.title}
                    <span className="block text-caption text-ink-muted">
                      {formatDayShort(t.dueAt, p.workspaceZone)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-ink-muted">
              No assignments due this week.
            </p>
          )}
        </Card>
      </aside>
    </div>
  );
}
