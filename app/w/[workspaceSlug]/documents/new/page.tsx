import { requireWorkspace } from "@/lib/permissions";
import { editorOptions } from "@/lib/documents/queries";
import { sourceDraft } from "@/lib/documents/sources";

import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { PageHeader } from "@/components/ui/display";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/documents/new">) {
  const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN"),
    options = await editorOptions(actor);
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const initial = await sourceDraft(actor, options.country, query);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Create document"
        description="Complete the source facts, add evidence and review before issuing."
      />
      <DocumentEditor
        slug={workspaceSlug}
        initial={initial}
        options={options}
      />
    </div>
  );
}
