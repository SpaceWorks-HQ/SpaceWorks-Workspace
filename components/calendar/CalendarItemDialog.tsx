"use client";

import Link from "next/link";
import { LAYERS } from "@/lib/calendar/algorithms";
import { formatTimeRange } from "@/lib/format/datetime";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { Dialog, DialogHeader, DialogBody, DialogContent } from "@/components/ui/dialog";
import { calendarRsvpAction } from "@/app/actions/calendar";
import { MeetLink } from "./MeetLink";
import type { CalendarItem, CalendarData, CalendarScreenProps, CalendarMutationRunner } from "./CalendarTypes";

export function CalendarItemDialog({
  p,
  selected,
  setSelected,
  meetingForm,
  setMeetingForm,
  entryForm,
  setEntryForm,
  editMeeting,
  editEntry,
  pending,
  run,
  setConfirm,
}: {
  p: CalendarScreenProps;
  selected: CalendarItem | null;
  setSelected: (item: CalendarItem | null) => void;
  meetingForm: boolean;
  setMeetingForm: (open: boolean) => void;
  entryForm: boolean;
  setEntryForm: (open: boolean) => void;
  editMeeting?: CalendarData["meetings"][number];
  editEntry?: CalendarData["entries"][number];
  pending: boolean;
  run: CalendarMutationRunner;
  setConfirm: (kind: "meeting" | "entry") => void;
}) {
  return (
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
                  <MeetLink url={editMeeting.videoUrl} pending={editMeeting.meetPending} error={editMeeting.calendarSyncs[0]?.lastError} />
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
  );
}
