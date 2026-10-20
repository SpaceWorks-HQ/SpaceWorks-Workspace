// Generated from app/w/[workspaceSlug]/documents/[documentId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { documentDetail, editorOptions } from "@/lib/documents/queries";
import { DocumentsError } from "@/lib/documents/access";
import type { DocumentSnapshot } from "@/lib/documents/service";

export async function loadPage({
  params,
}: PageProps<"/w/[workspaceSlug]/documents/[documentId]">) {
const { workspaceSlug, documentId } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN");
let detail;
try {
    detail = await documentDetail(actor, documentId);
  } catch (e) {
    if (e instanceof DocumentsError) notFound();
    throw e;
  }
const { row, input, files, allocations, corrections, deliveries, history } =
      detail,
    base = `/w/${workspaceSlug}/documents`,
    snapshot =
      row.type === "PAYSLIP"
        ? null
        : (row.snapshot as unknown as DocumentSnapshot | null),
    pdf = files.find((f) => f.kind === "PDF");
const options = await editorOptions(actor);
return viewDto({ workspaceSlug, actor, row, input, files, allocations, corrections, deliveries, history, base, snapshot, pdf, options } as const);
}
