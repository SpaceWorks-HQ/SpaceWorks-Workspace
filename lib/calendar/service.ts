import "server-only";

import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { type Actor, assertActor, ensure, serial, changed } from "@/lib/meetings/core";
import { managesMeeting } from "@/lib/meetings/service";
import { updateTask } from "@/lib/tasks/service";
import { calendarMeetingWhere } from "./access";
import { notifyMeeting } from "./service/notifications";

export { notifyMeeting };
export { saveMeeting } from "./service/scheduling";
export { saveEntry, deleteEntry } from "./service/entries";

export async function cancelMeeting(actor: Actor, meetingId: string) {
  const result = await serial(async (tx) => {
    await assertActor(actor, tx);
    const meeting = await tx.meeting.findFirst({
      where: {
        AND: [await calendarMeetingWhere(actor, tx), { id: meetingId }],
      },
    });
    ensure(meeting && managesMeeting(actor, meeting));
    if (meeting.status === "CANCELLED") return null;
    await tx.meeting.updateMany({
      where: { workspaceId: actor.workspace.id, id: meetingId },
      data: { status: "CANCELLED", sequence: { increment: 1 } },
    });
    await changed(
      tx,
      actor,
      "meeting",
      meeting.id,
      meeting.title,
      `meetings/${meeting.id}`,
      "cancelled",
      "",
      {
        visibility: meeting.visibility,
        teamId: meeting.teamId,
        ownerId: meeting.createdById,
      },
    );
    return notifyMeeting(tx, actor, meetingId, "meeting.cancelled");
  });
  await result?.afterCommit();
}
export async function moveTaskDue(actor: Actor, input: unknown) {
  await assertActor(actor);
  const data = z
    .object({
      taskId: z.string().min(1).max(100),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .parse(input);
  const result = await updateTask(actor, data);
  ensure(result.ok, result.ok ? undefined : result.error);
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: "calendar.task_due_changed",
    targetType: "Task",
    targetId: data.taskId,
    metadata: { dueDate: data.dueDate },
  });
}
