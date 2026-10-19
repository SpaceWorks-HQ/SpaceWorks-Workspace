export function mergedVoterIds(target: string[], source: string[]) {
  return [...new Set([...target, ...source])];
}

export const IDEA_LABELS: Record<string, string> = {
  NEW: "Open",
  UNDER_REVIEW: "In progress",
  PLANNED: "Planned",
  DONE: "Done",
  DECLINED: "Declined",
};
