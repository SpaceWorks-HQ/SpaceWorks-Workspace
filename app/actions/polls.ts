"use server";
import { collaborationAction } from "@/lib/meetings/action";
import { mutatePoll } from "@/lib/polls/service";
export async function pollAction(slug: string, input: unknown) {
  return collaborationAction(slug, "polls", (actor) =>
    mutatePoll(actor, input),
  );
}
