"use server";
import { collaborationAction } from "@/lib/meetings/action";
import { mutateGoal } from "@/lib/goals/service";
export async function goalAction(slug: string, input: unknown) {
  return collaborationAction(slug, "goals", (actor) =>
    mutateGoal(actor, input),
  );
}
