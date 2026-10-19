"use client";

import { useState } from "react";
import { Ellipsis } from "lucide-react";
import { addCommentAction, deleteCommentAction, editCommentAction } from "@/app/actions/tasks";
import { IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { formatDayTime, formatRelativeTime } from "@/lib/format/datetime";
import { decodeMentions, splitMentions } from "@/lib/tasks/mentions";
import type { CommentDTO, PersonRef, TaskDetailDTO } from "@/lib/tasks/types";
import { MentionComposer } from "./MentionComposer";
import type { RunAction } from "./useTaskRunner";

function CommentBody({ body, nameOf }: { body: string; nameOf: (id: string) => string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-body-ui text-ink">
      {splitMentions(body).map((segment, index) =>
        segment.type === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span key={index} className="font-semibold text-accent-text">
            @{nameOf(segment.userId)}
          </span>
        ),
      )}
    </p>
  );
}

export function TaskComments({ slug, task, run, mentionable }: { slug: string; task: TaskDetailDTO; run: RunAction; mentionable: PersonRef[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CommentDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const known = new Map<string, string>();
  for (const person of [...mentionable, ...task.comments.map((comment) => comment.author).filter((p): p is PersonRef => Boolean(p))]) {
    if (person.name) known.set(person.id, person.name);
  }
  const nameOf = (id: string) => known.get(id) ?? "former member";
  const canComment = task.permissions.canComment && !task.archivedAt;

  const submit = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    return ok;
  };

  return (
    <section aria-labelledby={`comments-${task.id}`} className="flex flex-col gap-4">
      <h3 id={`comments-${task.id}`} className="text-title text-ink">
        Comments
        {task.comments.filter((comment) => !comment.deleted).length ? <span className="ml-2 text-caption tabular-nums text-ink-muted">{task.comments.filter((comment) => !comment.deleted).length}</span> : null}
      </h3>
      {task.comments.length === 0 ? <p className="text-body-ui text-ink-muted">No comments yet. Ask a question or share an update.</p> : null}
      <ol className="flex flex-col gap-4">
        {task.comments.map((comment) => (
          <li key={comment.id} className="flex gap-3">
            <Avatar name={comment.author?.name ?? "Former member"} src={comment.author?.image} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-label text-ink">
                  <span className="font-semibold">{comment.author?.name ?? "Former member"}</span>{" "}
                  <time dateTime={comment.createdAt} title={formatDayTime(comment.createdAt, task.timeZone)} className="text-caption text-ink-muted">
                    {formatRelativeTime(comment.createdAt, task.timeZone)}
                  </time>
                  {comment.editedAt ? <span className="text-caption text-ink-muted"> · edited</span> : null}
                </p>
                {comment.canEdit && editing !== comment.id ? (
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton label="Comment options" size="sm">
                        <Ellipsis />
                      </IconButton>
                    </MenuTrigger>
                    <MenuContent>
                      {comment.author?.id === task.viewerId ? <MenuItem onSelect={() => setEditing(comment.id)}>Edit</MenuItem> : null}
                      <MenuItem danger onSelect={() => setDeleting(comment)}>
                        Delete…
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : null}
              </div>
              {comment.deleted ? (
                <p className="text-body-ui italic text-ink-muted">This comment was deleted.</p>
              ) : editing === comment.id ? (
                <div className="mt-1.5">
                  <MentionComposer
                    people={mentionable}
                    {...(() => {
                      const decoded = decodeMentions(comment.body, nameOf);
                      return { initialText: decoded.text, initialPicked: decoded.picked };
                    })()}
                    submitLabel="Save"
                    busy={busy}
                    autoFocus
                    onCancel={() => setEditing(null)}
                    onSubmit={(body) =>
                      submit(async () => {
                        const ok = await run(() => editCommentAction(slug, { commentId: comment.id, body }));
                        if (ok) setEditing(null);
                        return ok;
                      })
                    }
                  />
                </div>
              ) : (
                <div className="mt-0.5">
                  <CommentBody body={comment.body} nameOf={nameOf} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {canComment ? (
        <MentionComposer people={mentionable} busy={busy && editing === null} onSubmit={(body) => submit(() => run(() => addCommentAction(slug, { taskId: task.id, body })))} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this comment?"
        message="It's removed for everyone. The task history keeps a note that a comment was deleted."
        confirmLabel="Delete comment"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void submit(async () => {
            const ok = await run(() => deleteCommentAction(slug, { commentId: deleting!.id }), "Comment deleted.");
            setDeleting(null);
            return ok;
          })
        }
      />
    </section>
  );
}
