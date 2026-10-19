"use server";
import { collaborationAction } from "@/lib/meetings/action";
import { mutateIdea } from "@/lib/ideas/service";
export async function ideaAction(slug: string, input: unknown) {
  return collaborationAction(slug, "ideas", (actor) =>
    mutateIdea(actor, input),
  );
}
