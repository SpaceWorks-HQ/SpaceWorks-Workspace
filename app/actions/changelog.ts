"use server";
import { collaborationAction } from "@/lib/meetings/action";
import { mutateChangelog } from "@/lib/changelog/service";
export async function changelogAction(slug: string, input: unknown) {
  return collaborationAction(slug, "changelog", (actor) =>
    mutateChangelog(actor, input),
  );
}
