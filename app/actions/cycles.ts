"use server";
import { collaborationAction } from "@/lib/meetings/action";
import { mutateCycle } from "@/lib/cycles/service";
export async function cycleAction(slug: string, input: unknown) {
  return collaborationAction(slug, "cycles", (actor) =>
    mutateCycle(actor, input),
  );
}
