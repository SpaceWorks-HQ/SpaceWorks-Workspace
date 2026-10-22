"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { loadCalendar, CalendarItem } from "@/lib/calendar/query";
import { LAYERS, type Layer } from "@/lib/calendar/algorithms";
import { canManageCalendarDeadlines } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { cancelCalendarMeetingAction, deleteCalendarEntryAction } from "@/app/actions/calendar";
import { MeetingForm } from "./MeetingForm";
import { EntryForm } from "./EntryForm";
import { CalendarControls } from "./CalendarControls";
import { CalendarViews } from "./CalendarViews";
import { CalendarItemDialog } from "./CalendarItemDialog";
import type { CalendarScreenProps } from "./CalendarTypes";

export type CalendarData = Awaited<ReturnType<typeof loadCalendar>>;

export function CalendarScreen(p: CalendarScreenProps) {
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
  const items = p.data.items.filter(
    (i) =>
      layers.includes(i.layer) &&
      (!mine || i.mine) &&
      (!person || i.people.includes(person)) &&
      (!team || i.teamId === team) &&
      (!project || i.projectId === project) &&
      i.title.toLowerCase().includes(query.toLowerCase()),
  );
  const navigate = (date = p.date, view = p.view, zone = p.zone) => {
    startTransition(() =>
      router.push(
        `/w/${p.slug}/calendar?${new URLSearchParams({ date, view, zone })}`,
      ),
    );
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
      <CalendarControls
        p={p}
        guest={guest}
        items={items}
        pending={pending}
        layers={layers}
        setLayers={setLayers}
        query={query}
        setQuery={setQuery}
        person={person}
        setPerson={setPerson}
        team={team}
        setTeam={setTeam}
        project={project}
        setProject={setProject}
        mine={mine}
        setMine={setMine}
        setMessage={setMessage}
        run={run}
        navigate={navigate}
      />
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
      <CalendarViews
        p={p}
        guest={guest}
        items={items}
        setMeetingForm={setMeetingForm}
        setEntryForm={setEntryForm}
        setTaskNumber={setTaskNumber}
        open={open}
        run={run}
        navigate={navigate}
      />
      <TaskDrawer
        slug={p.slug}
        number={taskNumber}
        onClose={() => setTaskNumber(null)}
        onChanged={() => router.refresh()}
      />
      <CalendarItemDialog
        p={p}
        selected={selected}
        setSelected={setSelected}
        meetingForm={meetingForm}
        setMeetingForm={setMeetingForm}
        entryForm={entryForm}
        setEntryForm={setEntryForm}
        editMeeting={editMeeting}
        editEntry={editEntry}
        pending={pending}
        run={run}
        setConfirm={setConfirm}
      />
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
