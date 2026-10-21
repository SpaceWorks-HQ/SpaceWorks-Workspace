export type PlanTask = {
  id: string; title: string; reference: string; url: string; parentId: string | null;
  start: string | null; end: string | null; done: boolean; overdue: boolean;
  blockerReason: string | null; blockerOwnerId: string | null; owner: string;
  blockedBy: Array<{ reference: string; title: string; url: string }>;
  restrictedBlocker: boolean;
};
export type MilestoneRow = {
  id: string; name: string; targetOn: string; status: string; manualStatus: string; notes: string;
  taskIds: string[]; tasks: Array<{ id: string; title: string; done: boolean; archived: boolean }>;
};
export type UpdateRow = { id: string; status: string; note: string; blockers: string[]; nextSteps: string[]; author: string; createdAt: string };
export type ProjectPlan = {
  projectId: string; name: string; key: string; base: string; timeZone: string;
  startsOn: string | null; dueOn: string | null; lead: string;
  canManage: boolean; tasks: PlanTask[]; milestones: MilestoneRow[]; updates: UpdateRow[];
  progress: { total: number; done: number; percent: number }; updateDueAt: string; updateOverdue: boolean;
};
export type BlockerRow = PlanTask & { projectName: string; projectKey: string; projectId: string };
