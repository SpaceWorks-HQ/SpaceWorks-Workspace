"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, Check, Ellipsis, Link as LinkIcon, RotateCcw } from "lucide-react";
import {
  loadTaskAction,
  moveTaskAction,
  setAssigneesAction,
  setLabelsAction,
  setTaskArchivedAction,
  setTaskCompletedAction,
  updateTaskAction,
} from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Callout, Chip } from "@/components/ui/display";
import { Dropdown } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { controlClasses } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { formatDate, formatRelativeTime } from "@/lib/format/datetime";
import { labelChipTone } from "@/lib/labels";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/tasks/filters";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import { toDateInputValue } from "@/lib/tasks/localDate";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import { BlockedChip, DueChip, PriorityChip } from "./bits";
import { MultiSelect } from "./MultiSelect";
import { RepeatControl } from "./RepeatControl";
import { RichTextEditor, RichTextView } from "./RichTextEditor";
import { TaskPlan } from "@/components/projects/TaskPlan";
import { TaskAttachments } from "./TaskAttachments";
import { TaskComments } from "./TaskComments";
import { TaskDependencies } from "./TaskDependencies";
import { TaskSubtasks } from "./TaskSubtasks";
import { useTaskRunner } from "./useTaskRunner";

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="pt-2.5 text-label text-ink-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function TitleEditor({ value, editable, onSave, as }: { value: string; editable: boolean; onSave: (title: string) => Promise<boolean>; as: "h1" | "h2" }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  const Heading = as;
  if (!editable) return <Heading className={cn("break-words text-ink", as === "h1" ? "text-h1" : "text-h3")}>{value}</Heading>;
  const commit = async () => {
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) return setDraft(value);
    if (next !== value && !(await onSave(next))) setDraft(value);
  };
  return (
    <Heading className="m-0">
      <textarea
        ref={ref}
        value={draft}
        rows={1}
        maxLength={200}
        aria-label="Task title"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 -mx-2 font-display font-semibold text-ink hover:border-line focus:border-accent focus:bg-panel focus:outline-none",
          as === "h1" ? "text-h1" : "text-h3",
        )}
      />
    </Heading>
  );
}

/**
 * Everything about one task: title, status, priority, people, labels, due
 * date, repeat, description, subtasks, dependencies, attachments, comments
 * and history. Used by the full task page and the board's side panel.
 * Refetches through `loadTaskAction` after each change and when someone
 * else changes the task (realtime `task:<id>`).
 */
export function TaskDetail({ slug, initial, variant, onChanged }: { slug: string; initial: TaskDetailDTO; variant: "page" | "drawer"; onChanged?: () => void }) {
  const [task, setTask] = useState(initial);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const { showToast } = useToast();
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setTask(initial);
  }

  const reload = useCallback(async () => {
    const next = await loadTaskAction(slug, task.number);
    if (next) setTask(next);
    onChanged?.();
  }, [slug, task.number, onChanged]);
  const run = useTaskRunner(reload);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(
    slug,
    useCallback(
      (event) => {
        if (event.channel !== `task:${task.id}` || event.actorId === task.viewerId) return;
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => {
          void loadTaskAction(slug, task.number).then((next) => next && setTask(next));
        }, 300);
      },
      [slug, task.id, task.number, task.viewerId],
    ),
  );

  const canEdit = task.permissions.canEdit && !task.archivedAt;
  const reference = taskReference(task.project?.key, task.number);
  const column = task.columns.find((item) => item.id === task.columnId) ?? null;
  const isPage = variant === "page";
  const url = taskUrl(slug, task.project?.key, task.number);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
      showToast(`Link to ${reference} copied.`, "success");
    } catch {
      showToast("Couldn't copy the link. Copy it from the address bar instead.", "error");
    }
  };

  const assigneeItems = task.members.map((person) => ({ id: person.id, label: person.name ?? "Member", leading: <Avatar name={person.name} src={person.image} size="xs" /> }));
  const labelItems = task.labels.map((label) => ({ id: label.id, label: label.name }));
  const visibleActivity = showAllActivity ? task.activity : task.activity.slice(0, 8);

  const properties = (
    <dl className="divide-y divide-line">
      {task.project && !task.parent ? (
        <Property label="Status">
          {canEdit ? (
            <Dropdown aria-label="Status" value={task.columnId ?? ""} onChange={(event) => void run(() => moveTaskAction(slug, { taskId: task.id, columnId: event.target.value, afterTaskId: null }))}>
              {task.columnId ? null : <option value="">No status</option>}
              {task.columns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Dropdown>
          ) : (
            <p className="pt-2.5 text-body-ui text-ink">{column?.name ?? "No status"}</p>
          )}
        </Property>
      ) : null}
      <Property label="Priority">
        {canEdit ? (
          <Dropdown aria-label="Priority" value={task.priority} onChange={(event) => void run(() => updateTaskAction(slug, { taskId: task.id, priority: event.target.value }))}>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Dropdown>
        ) : (
          <div className="pt-2">{task.priority === "NONE" ? <span className="text-body-ui text-ink-muted">No priority</span> : <PriorityChip priority={task.priority} size="md" />}</div>
        )}
      </Property>
      <Property label="Assignees">
        <div className="flex flex-col items-start gap-1.5 pt-1.5">
          {task.assignees.length ? (
            <ul className="flex flex-col gap-1.5">
              {task.assignees.map((person) => (
                <li key={person.id} className="flex items-center gap-2 text-body-ui text-ink">
                  <Avatar name={person.name} src={person.image} size="xs" />
                  {person.name ?? "Member"}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-body-ui text-ink-muted">Nobody yet</span>
          )}
          {canEdit ? (
            <MultiSelect
              title="Assignees"
              commitOnClose
              trigger={
                <Button variant="quiet" size="sm">
                  {task.assignees.length ? "Change" : "Assign"}
                </Button>
              }
              items={assigneeItems}
              selected={task.assignees.map((person) => person.id)}
              onChange={(userIds) => void run(() => setAssigneesAction(slug, { taskId: task.id, userIds }))}
              searchPlaceholder="Find a member"
            />
          ) : null}
        </div>
      </Property>
      <Property label="Labels">
        <div className="flex flex-col items-start gap-1.5 pt-2">
          {task.labelIds.length ? (
            <div className="flex flex-wrap gap-1.5">
              {task.labelIds.map((id) => {
                const label = task.labels.find((item) => item.id === id);
                return label ? (
                  <Chip key={id} tone={labelChipTone(label.tone)} size="sm">
                    {label.name}
                  </Chip>
                ) : null;
              })}
            </div>
          ) : (
            <span className="text-body-ui text-ink-muted">None</span>
          )}
          {canEdit ? (
            <MultiSelect
              title="Labels"
              commitOnClose
              trigger={
                <Button variant="quiet" size="sm">
                  {task.labelIds.length ? "Change" : "Add labels"}
                </Button>
              }
              items={labelItems}
              selected={task.labelIds}
              onChange={(labelIds) => void run(() => setLabelsAction(slug, { taskId: task.id, labelIds }))}
              emptyText="No labels yet. Admins add them in settings."
            />
          ) : null}
        </div>
      </Property>
      <Property label="Due date">
        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Due date"
              className={cn(controlClasses, "min-w-0")}
              value={toDateInputValue(task.dueAt ? new Date(task.dueAt) : null, task.timeZone)}
              onChange={(event) => void run(() => updateTaskAction(slug, { taskId: task.id, dueDate: event.target.value || null }))}
            />
            {task.dueAt ? (
              <Button variant="quiet" size="sm" onClick={() => void run(() => updateTaskAction(slug, { taskId: task.id, dueDate: null }))}>
                Clear
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="pt-2">{task.dueAt ? <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={task.timeZone} size="md" /> : <span className="text-body-ui text-ink-muted">No due date</span>}</div>
        )}
      </Property>
      <Property label="Repeat">
        <div className="pt-2">
          <RepeatControl key={`${task.recurrence?.id ?? "none"}-${task.recurrence?.rrule ?? ""}-${task.recurrence?.active ?? ""}`} slug={slug} task={task} run={run} />
        </div>
      </Property>
      <Property label="Created">
        <p className="pt-2.5 text-body-ui text-ink-secondary">
          {formatDate(task.createdAt, task.timeZone)} by {task.creator?.name ?? "a former member"}
        </p>
      </Property>
    </dl>
  );

  return (
    <article className="flex flex-col gap-6" aria-label={`${reference} ${task.title}`}>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
          {task.project ? (
            <Link href={`/w/${slug}/projects/${task.project.key}`} className="font-semibold text-ink-secondary underline-offset-4 hover:underline">
              {task.project.name}
            </Link>
          ) : (
            <Link href={`/w/${slug}/my-tasks`} className="font-semibold text-ink-secondary underline-offset-4 hover:underline">
              My tasks
            </Link>
          )}
          {task.parent ? (
            <>
              <span aria-hidden>/</span>
              <Link href={taskUrl(slug, task.parent.projectKey, task.parent.number)} className="font-semibold text-ink-secondary underline-offset-4 hover:underline">
                {taskReference(task.parent.projectKey, task.parent.number)} {task.parent.title}
              </Link>
            </>
          ) : null}
          <span aria-hidden>/</span>
          <span className="font-semibold tabular-nums">{reference}</span>
        </div>
        <TitleEditor value={task.title} as={isPage ? "h1" : "h2"} editable={canEdit} onSave={(title) => run(() => updateTaskAction(slug, { taskId: task.id, title }))} />
        <div className="flex flex-wrap items-center gap-2">
          {task.completedAt ? (
            <Chip tone="success" icon={<Check />}>
              Done
            </Chip>
          ) : column ? (
            <Chip tone={column.category === "IN_PROGRESS" ? "info" : "neutral"}>{column.name}</Chip>
          ) : (
            <Chip tone="neutral">Open</Chip>
          )}
          {(Boolean(task.blockerReason) || task.blockedBy.some((item) => !item.completedAt && !item.archivedAt)) ? <BlockedChip size="md" /> : null}
          {task.archivedAt ? <Chip tone="outline">Archived</Chip> : null}
          <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={task.timeZone} size="md" />
          <div className="ml-auto flex items-center gap-1.5">
            {canEdit ? (
              <Button
                variant={task.completedAt ? "secondary" : "primary"}
                size="sm"
                startIcon={task.completedAt ? <RotateCcw /> : <Check />}
                onClick={() => void run(() => setTaskCompletedAction(slug, { taskId: task.id, completed: !task.completedAt }), task.completedAt ? `${reference} reopened.` : `${reference} done. Nice work.`)}
              >
                {task.completedAt ? "Reopen" : "Mark done"}
              </Button>
            ) : null}
            {variant === "drawer" ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={url}>
                  Open page
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              </Button>
            ) : null}
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="More task actions" variant="secondary">
                  <Ellipsis />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<LinkIcon />} onSelect={() => void copyLink()}>
                  Copy link
                </MenuItem>
                {task.permissions.canEdit ? (
                  task.archivedAt ? (
                    <MenuItem icon={<RotateCcw />} onSelect={() => void run(() => setTaskArchivedAction(slug, { taskId: task.id, archived: false }), `${reference} restored.`)}>
                      Restore task
                    </MenuItem>
                  ) : (
                    <MenuItem icon={<Archive />} onSelect={() => void run(() => setTaskArchivedAction(slug, { taskId: task.id, archived: true }), `${reference} archived. Restore it from this page any time.`)}>
                      Archive task
                    </MenuItem>
                  )
                ) : null}
              </MenuContent>
            </Menu>
          </div>
        </div>
      </header>

      {task.archivedAt ? (
        <Callout tone="info" title="This task is archived." action={task.permissions.canEdit ? <Button size="sm" variant="secondary" onClick={() => void run(() => setTaskArchivedAction(slug, { taskId: task.id, archived: false }), `${reference} restored.`)}>Restore</Button> : null}>
          It&apos;s hidden from the board and My tasks.
        </Callout>
      ) : null}
      {task.project?.status === "ARCHIVED" ? <Callout tone="info" title="This project is archived.">Tasks stay readable. Restore the project to change them.</Callout> : null}

      <div className={cn("grid gap-8", isPage && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
        {isPage ? (
          <aside aria-label="Details" className="lg:order-2">
            <div className="rounded-xl border border-line bg-panel px-4 py-1 lg:sticky lg:top-6">{properties}</div>
          </aside>
        ) : null}
        <div className={cn("flex min-w-0 flex-col gap-8", isPage && "lg:order-1")}>
          {!isPage ? <section aria-label="Details" className="rounded-xl border border-line bg-panel px-4 py-1">{properties}</section> : null}
          <section aria-labelledby={`desc-${task.id}`} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`desc-${task.id}`} className="text-title text-ink">
                Description
              </h3>
              {canEdit && !editingDescription ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDescriptionDraft(task.description ?? "");
                    setEditingDescription(true);
                  }}
                >
                  {task.description ? "Edit" : "Add description"}
                </Button>
              ) : null}
            </div>
            {editingDescription ? (
              <div className="flex flex-col gap-2">
                <RichTextEditor initialHtml={task.description ?? ""} onChange={setDescriptionDraft} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingDescription(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      void run(() => updateTaskAction(slug, { taskId: task.id, description: descriptionDraft || null })).then((ok) => {
                        if (ok) setEditingDescription(false);
                      })
                    }
                  >
                    Save description
                  </Button>
                </div>
              </div>
            ) : task.description ? (
              <RichTextView html={task.description} />
            ) : (
              <p className="text-body-ui text-ink-muted">{canEdit ? "Add the details someone needs to pick this up." : "No description."}</p>
            )}
          </section>
          <TaskPlan key={`${task.id}-${task.updatedAt}`} slug={slug} task={task} reload={reload} />
          <TaskSubtasks slug={slug} task={task} run={run} />
          <TaskDependencies slug={slug} task={task} run={run} />
          <TaskAttachments slug={slug} task={task} run={run} />
          <TaskComments slug={slug} task={task} run={run} mentionable={task.members} />
          <section aria-labelledby={`history-${task.id}`} className="flex flex-col gap-3">
            <h3 id={`history-${task.id}`} className="text-title text-ink">
              History
            </h3>
            <ol className="flex flex-col gap-2.5 border-l border-line pl-4">
              {visibleActivity.map((item) => (
                <li key={item.id} className="text-body-ui text-ink-secondary">
                  <span className="font-semibold text-ink">{item.actor?.name ?? (item.kind === "created_recurring" ? "This task" : "Someone")}</span> {item.text}
                  <span className="text-caption text-ink-muted"> · {formatRelativeTime(item.createdAt, task.timeZone)}</span>
                </li>
              ))}
            </ol>
            {task.activity.length > 8 ? (
              <Button variant="quiet" size="sm" className="self-start" onClick={() => setShowAllActivity((value) => !value)}>
                {showAllActivity ? "Show less" : `Show all ${task.activity.length}`}
              </Button>
            ) : null}
          </section>
        </div>
      </div>
    </article>
  );
}
