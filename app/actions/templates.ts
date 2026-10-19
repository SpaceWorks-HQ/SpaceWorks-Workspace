"use server";
import { collaborationAction } from "@/lib/meetings/action";
import { mutateTemplate } from "@/lib/templates/service";
export async function templateAction(slug: string, input: unknown) {
  return collaborationAction(slug, "templates", (actor) =>
    mutateTemplate(actor, input),
  );
}
