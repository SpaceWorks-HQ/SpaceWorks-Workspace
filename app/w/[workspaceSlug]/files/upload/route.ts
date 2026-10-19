import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canContribute } from "@/lib/roles";
import { checkRateLimitById } from "@/lib/rateLimit";
import { isTrustedMutation, jsonResponse, notFoundResponse, routeActor } from "@/lib/files/request";
import { uploadLibraryFile, uploadNewVersion } from "@/lib/files/service";
import { fileUrl } from "@/lib/storage";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const fieldsSchema = z.object({
  folder: z.string().trim().max(300).optional(),
  docId: idSchema.optional(),
  taskId: idSchema.optional(),
  replaceFileId: idSchema.optional(),
  note: z.string().trim().max(200).optional(),
});

/**
 * Upload one file (multipart field `file`) into the library, into a doc
 * (`docId`, e.g. an editor image) or as a new version of a library file
 * (`replaceFileId`). A route handler rather than a Server Action so the
 * browser can report progress. Members only; non-members get 404.
 */
export async function POST(request: Request, ctx: RouteContext<"/w/[workspaceSlug]/files/upload">) {
  const { workspaceSlug } = await ctx.params;
  if (!isTrustedMutation(request)) return jsonResponse({ ok: false, error: "This upload was blocked. Reload the page and try again." }, 403);
  const actor = await routeActor(workspaceSlug);
  if (!actor) return notFoundResponse();
  if (!canContribute(actor.membership)) return jsonResponse({ ok: false, error: "You don't have access to do that." }, 403);
  if (!(await checkRateLimitById("upload", `user:${actor.user.id}`))) {
    return jsonResponse({ ok: false, error: "Too many uploads. Wait a few minutes and try again." }, 429);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: "That upload didn't arrive in one piece. Try again." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonResponse({ ok: false, error: "Choose a file to upload." }, 400);
  const fields = fieldsSchema.safeParse({
    folder: form.get("folder") ?? undefined,
    docId: form.get("docId") || undefined,
    taskId: form.get("taskId") || undefined,
    replaceFileId: form.get("replaceFileId") || undefined,
    note: form.get("note") || undefined,
  });
  if (!fields.success) return jsonResponse({ ok: false, error: "Check the upload details and try again." }, 400);

  const filesActor = { workspace: actor.workspace, user: actor.user, membership: actor.membership };
  if (fields.data.replaceFileId) {
    const result = await uploadNewVersion(filesActor, { fileId: fields.data.replaceFileId, file, note: fields.data.note });
    if (!result.ok) return jsonResponse(result, 400);
    revalidatePath(`/w/${actor.workspace.slug}/files`, "layout");
    return jsonResponse({ ok: true, file: { id: fields.data.replaceFileId, version: result.data.version } });
  }

  const result = await uploadLibraryFile(filesActor, { file, folder: fields.data.folder, docId: fields.data.docId, taskId: fields.data.taskId });
  if (!result.ok) return jsonResponse(result, 400);
  if (!fields.data.docId) revalidatePath(`/w/${actor.workspace.slug}/files`, "layout");
  return jsonResponse({ ok: true, file: { id: result.data.id, filename: result.data.filename, contentType: result.data.contentType, url: fileUrl(result.data.id) } });
}
