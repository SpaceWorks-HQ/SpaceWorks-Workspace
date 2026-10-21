"use client";
import { useMemo, useState, useTransition, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { WorkspaceRole } from "@prisma/client";
import type { loadCalendar, CalendarItem } from "@/lib/calendar/query";
import { LAYERS, csvCell, type Layer } from "@/lib/calendar/algorithms";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import {
  formatDayShort,
  formatTimeRange,
  formatDate,
} from "@/lib/format/datetime";
import { canManageCalendarDeadlines } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import {
  Avatar,
  Callout,
  Card,
  Chip,
  EmptyState,
} from "@/components/ui/display";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogContent,
  ConfirmDialog,
} from "@/components/ui/dialog";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { MeetingForm } from "./MeetingForm";
import { EntryForm } from "./EntryForm";
import {
  calendarRsvpAction,
  cancelCalendarMeetingAction,
  moveCalendarTaskAction,
  syncCalendarGoogleAction,
  connectCalendarGoogleAction,
  deleteCalendarEntryAction,
} from "@/app/actions/calendar";
export type CalendarData = Awaited<ReturnType<typeof loadCalendar>>;
type Props = {
  data: CalendarData;
  assigned: { id: string; title: string; number: number; dueAt: string }[];
  slug: string;
  viewerId: string;
  role: WorkspaceRole;
  workspaceZone: string;
  viewerZone: string;
  zone: string;
  date: string;
  view: string;
  firstDay: string;
  dayCount: number;
  googleConnected: boolean;
  googleError: boolean;
};
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
const subscribeZone = () => () => {};
const browserZoneSnapshot = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
export function CalendarScreen(p: Props) {
  const browserZone = useSyncExternalStore(
    subscribeZone,
    browserZoneSnapshot,
    () => p.viewerZone,
  );
  const router = useRouter(),
    [pending, startTransition] = useTransition();
  const [layers, setLayers] = useState<Layer[]>(Object.keys(LAYERS) as Layer[]),
    [mine, setMine] = useState(false),
    [person, setPerson] = useState(""),
    [team, setTeam] = useState(""),
    [project, setProject] = useState(""),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CalendarItem | null>(null),
    [meetingForm, setMeetingForm] = useState(false),
    [entryForm, setEntryForm] = useState(false),
    [taskNumber, setTaskNumber] = useState<number | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<"meeting" | "entry" | null>(null);
  const guest = p.role === "GUEST";
  const editMeeting =
    selected?.layer === "meeting"
      ? p.data.meetings.find((m) => m.id === selected.sourceId)
      : undefined;
  const editEntry =
    selected && ["deadline", "reminder"].includes(selected.layer)
      ? p.data.entries.find((e) => e.id === selected.sourceId)
      : undefined;
  const days = useMemo(
    () =>
      Array.from({ length: p.dayCount }, (_, i) => {
        const d = new Date(`${p.firstDay}T12:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
      }),
    [p.firstDay, p.dayCount],
  );
  const items = p.data.items.filter(
    (i) =>
      layers.includes(i.layer) &&
      (!mine || i.mine) &&
      (!person || i.people.includes(person)) &&
      (!team || i.teamId === team) &&
      (!project || i.projectId === project) &&
      i.title.toLowerCase().includes(query.toLowerCase()),
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
  const navigate = (date = p.date, view = p.view, zone = p.zone) => {
    startTransition(() =>
      router.push(
        `/w/${p.slug}/calendar?${new URLSearchParams({ date, view, zone })}`,
      ),
    );
  };
  const move = (amount: number) => {
    const d = new Date(`${p.date}T12:00Z`);
    if (p.view === "month") {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + amount);
    } else
      d.setUTCDate(
        d.getUTCDate() +
          amount * (p.view === "day" ? 1 : p.view === "week" ? 7 : 30),
      );
    navigate(d.toISOString().slice(0, 10));
  };
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) => {
    setError("");
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) setError(r.error ?? "Couldn't save. Try again.");
        else {
          setMessage(success);
          setSelected(null);
          router.refresh();
        }
      } catch {
        setError("Couldn't save. Try again.");
      }
    });
  };
  const open = (item: CalendarItem) => {
    if (item.taskNumber) setTaskNumber(item.taskNumber);
    else setSelected(item);
  };
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
  const exportCsv = () => {
    const text = [
      ["Layer", "Title", "Starts", "Ends", "Time zone", "Status"],
      ...items.map((i) => [
        LAYERS[i.layer],
        i.title,
        i.start,
        i.end,
        p.zone,
        i.status ?? "",
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "team-calendar.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-5" aria-busy={pending}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ink">Team calendar</h1>
          <p className="mt-1 text-ink-muted">
            Meetings, assignments and the dates your team works towards.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!guest && (
            <Button
              onClick={() => {
                setSelected(null);
                setMeetingForm(true);
              }}
            >
              Schedule meeting
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setSelected(null);
              setEntryForm(true);
            }}
          >
            Add reminder
          </Button>
        </div>
      </header>
      {error && (
        <Callout role="alert" tone="danger">
          {error}
        </Callout>
      )}
      <p role="status" className="text-ink-secondary">
        {message}
      </p>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              aria-label="Previous period"
              onClick={() => move(-1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                navigate(
                  zonedDatetimeLocalValue(new Date(), p.zone).slice(0, 10),
                )
              }
            >
              Today
            </Button>
            <Button
              variant="secondary"
              aria-label="Next period"
              onClick={() => move(1)}
            >
              Next
            </Button>
          </div>
          <Field label="Date">
            <Input
              type="date"
              value={p.date}
              onChange={(e) => {
                if (e.target.value) navigate(e.target.value);
              }}
            />
          </Field>
          <Field label="Time zone">
            <Dropdown
              value={p.zone}
              onChange={(e) => navigate(p.date, p.view, e.target.value)}
            >
              {[
                ...new Set([
                  p.workspaceZone,
                  p.viewerZone,
                  browserZone,
                  p.zone,
                  "UTC",
                ]),
              ].map((z) => (
                <option key={z} value={z}>
                  {z === p.workspaceZone
                    ? `Workspace · ${z}`
                    : `My view · ${z}`}
                </option>
              ))}
            </Dropdown>
          </Field>
        </div>
        <nav aria-label="Calendar views" className="flex flex-wrap gap-2">
          {["day", "week", "month", "agenda"].map((view) => (
            <Button
              key={view}
              variant="quiet"
              aria-pressed={p.view === view}
              onClick={() => navigate(p.date, view)}
              className={
                p.view === view ? "border-b-2 border-accent rounded-none" : ""
              }
            >
              {view[0].toUpperCase() + view.slice(1)}
            </Button>
          ))}
        </nav>
        <fieldset>
          <legend className="text-label">Layers</legend>
          <div className="flex flex-wrap gap-x-4">
            {(Object.entries(LAYERS) as [Layer, string][])
              .filter(
                ([key]) =>
                  (key !== "google" || p.googleConnected) &&
                  (!guest || ["meeting", "task", "reminder"].includes(key)),
              )
              .map(([key, label]) => (
                <label
                  key={key}
                  className="flex min-h-11 items-center gap-2 text-body-ui"
                >
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={layers.includes(key)}
                    onChange={(e) =>
                      setLayers(
                        e.target.checked
                          ? [...layers, key]
                          : layers.filter((l) => l !== key),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {!guest && (
            <>
              <Field label="Person">
                <Dropdown
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                >
                  <option value="">Everyone I can see</option>
                  {p.data.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name ?? "Member"}
                    </option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Team">
                <Dropdown
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                >
                  <option value="">All visible teams</option>
                  {p.data.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="Project">
                <Dropdown
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">All visible projects</option>
                  {p.data.projects.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
            />
            Only mine
          </label>
          {!guest && (
            <Button
              variant="quiet"
              onClick={() => {
                const own = p.data.teams.find((t) =>
                  t.members.some((m) => m.userId === p.viewerId),
                );
                if (own) setTeam(own.id);
                else setMessage("You have no team yet.");
              }}
            >
              My team
            </Button>
          )}
          <Button variant="quiet" onClick={exportCsv}>
            Export CSV
          </Button>
          <Link
            className="inline-flex min-h-11 items-center text-accent-text underline"
            href={`/w/${p.slug}/calendar/subscribe`}
          >
            Personal ICS feed
          </Link>
          {!guest && (
            <>
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() =>
                  run(
                    async () => {
                      if (p.googleConnected) {
                        const r = await syncCalendarGoogleAction(p.slug);
                        if (r.ok && r.data?.failed)
                          return {
                            ok: false,
                            error:
                              "Some Google events could not sync. Try again.",
                          };
                        if (r.ok)
                          setMessage(`Synced ${r.data?.synced ?? 0} meetings.`);
                        return r;
                      }
                      const r = await connectCalendarGoogleAction(p.slug);
                      if (r.ok && r.data) window.location.assign(r.data);
                      return r;
                    },
                    p.googleConnected
                      ? "Google sync finished."
                      : "Opening Google",
                  )
                }
              >
                {p.googleConnected
                  ? "Sync my Google Calendar"
                  : "Connect my Google Calendar"}
              </Button>
            </>
          )}
        </div>
      </Card>
      {p.googleError && (
        <Callout tone="warning">
          Google busy times could not be loaded. Reconnect or try again.
        </Callout>
      )}
      {p.data.truncated && (
        <Callout tone="warning">
          This period has more than 1,000 records in a layer. Choose day or week
          to see a smaller range.
        </Callout>
      )}
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
      <TaskDrawer
        slug={p.slug}
        number={taskNumber}
        onClose={() => setTaskNumber(null)}
        onChanged={() => router.refresh()}
      />
      <Dialog
        open={!!selected && !meetingForm && !entryForm}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent size="md">
          <DialogHeader title={selected?.title ?? "Calendar item"} />
          <DialogBody>
            {selected && (
              <div className="space-y-4">
                <Chip>{LAYERS[selected.layer]}</Chip>
                <p>{formatTimeRange(selected.start, selected.end, p.zone)}</p>
                {editMeeting && (
                  <>
                    <p>{editMeeting.location}</p>
                    {editMeeting.videoUrl && (
                      <a
                        href={editMeeting.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-text underline"
                      >
                        Join video meeting
                      </a>
                    )}
                    <p className="text-ink-muted">
                      {editMeeting.attendees.length} attendees ·{" "}
                      {editMeeting.status.toLowerCase().replaceAll("_", " ")}
                    </p>
                    {editMeeting.attendees.some(
                      (a) => a.userId === p.viewerId,
                    ) &&
                      editMeeting.status !== "CANCELLED" && (
                        <div
                          className="flex flex-wrap gap-2"
                          aria-label="Your response"
                        >
                          {(["YES", "MAYBE", "NO"] as const).map((r, i) => (
                            <Button
                              key={r}
                              variant="secondary"
                              disabled={pending}
                              aria-pressed={
                                editMeeting.attendees.find(
                                  (a) => a.userId === p.viewerId,
                                )?.rsvp === r
                              }
                              onClick={() =>
                                run(
                                  () =>
                                    calendarRsvpAction(
                                      p.slug,
                                      editMeeting.id,
                                      r,
                                    ),
                                  "Your response was saved.",
                                )
                              }
                            >
                              {["Accept", "Tentative", "Decline"][i]}
                            </Button>
                          ))}
                        </div>
                      )}
                    <ul>
                      {editMeeting.agenda.map((a) => (
                        <li key={a.id}>{a.title}</li>
                      ))}
                    </ul>
                  </>
                )}
                {editEntry && (
                  <>
                    <p className="whitespace-pre-wrap">{editEntry.notes}</p>
                    <ul>
                      {editEntry.fileIds.map((id, i) => (
                        <li key={id}>
                          <a
                            className="inline-flex min-h-11 items-center text-accent-text underline"
                            href={`/api/files/${id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Preview attachment {i + 1}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!editEntry && (
                  <Link
                    href={selected.url}
                    className="inline-flex min-h-11 items-center text-accent-text underline"
                  >
                    {editMeeting ? "Open agenda and notes" : "Open record"}
                  </Link>
                )}
                {selected.editable && (
                  <div className="flex flex-wrap gap-2">
                    {editMeeting && editMeeting.status !== "CANCELLED" && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => setMeetingForm(true)}
                        >
                          Edit meeting
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setConfirm("meeting")}
                        >
                          Cancel meeting…
                        </Button>
                      </>
                    )}
                    {editEntry && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => setEntryForm(true)}
                        >
                          Edit and attach files
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setConfirm("entry")}
                        >
                          Delete entry…
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "meeting"
            ? "Cancel this meeting?"
            : "Delete this calendar entry?"
        }
        message={
          confirm === "meeting"
            ? "Attendees receive a cancellation. Other occurrences stay scheduled."
            : "This removes this occurrence from the calendar."
        }
        confirmLabel={confirm === "meeting" ? "Cancel meeting" : "Delete entry"}
        loading={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!selected) return;
          const id = selected.sourceId;
          run(
            () =>
              confirm === "meeting"
                ? cancelCalendarMeetingAction(p.slug, id)
                : deleteCalendarEntryAction(p.slug, id),
            "Calendar updated.",
          );
          setConfirm(null);
        }}
      />
      {meetingForm && (
        <MeetingForm
          slug={p.slug}
          zone={p.zone}
          date={p.date}
          data={p.data}
          meeting={editMeeting}
          viewerId={p.viewerId}
          googleConnected={p.googleConnected}
          onClose={() => {
            setMeetingForm(false);
            setSelected(null);
          }}
        />
      )}
      {entryForm && (
        <EntryForm
          slug={p.slug}
          zone={p.zone}
          date={p.date}
          data={p.data}
          entry={editEntry}
          canDeadline={canManageCalendarDeadlines({ role: p.role })}
          onClose={() => {
            setEntryForm(false);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
