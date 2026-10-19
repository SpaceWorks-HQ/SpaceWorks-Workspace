export type CycleTask = {
  id: string;
  completedAt: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
};

export function carryOverTaskIds(tasks: CycleTask[]) {
  return tasks
    .filter((task) => !task.completedAt && !task.archivedAt)
    .map((task) => task.id);
}

/** Completion history for the cycle's current task set. Scope changes are explicit in the caption. */
export function burnUp(
  tasks: CycleTask[],
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
) {
  const start = startsAt.getTime();
  const end = Math.min(endsAt.getTime(), Math.max(start, now.getTime()));
  const steps = Math.min(
    60,
    Math.max(1, Math.ceil((end - start) / 86_400_000)),
  );
  return Array.from({ length: steps + 1 }, (_, i) => {
    const at = new Date(start + ((end - start) * i) / steps);
    return {
      at: at.toISOString(),
      scope: tasks.filter((t) => t.createdAt <= at).length,
      completed: tasks.filter((t) => t.completedAt && t.completedAt <= at)
        .length,
    };
  });
}
