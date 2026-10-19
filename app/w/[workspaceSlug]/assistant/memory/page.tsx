import { MemoryManager } from "@/components/assistant/MemoryManager";
import { requireWorkspace } from "@/lib/permissions";
import { formatRelativeTime } from "@/lib/format/datetime";
import { searchMemories } from "@/lib/assistant/memory";
import { userNames } from "@/lib/assistant/tools/access";

export const metadata = { title: "Assistant memory" };

export default async function AssistantMemoryPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/assistant/memory">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const query = (await searchParams).q;
  const q = typeof query === "string" ? query.slice(0, 200) : "";
  const rows = await searchMemories(workspace.id, q, 100);
  const names = await userNames(rows.map((r) => r.createdById));
  const now = new Date();
  return (
    <MemoryManager
      slug={workspace.slug}
      query={q}
      memories={rows.map((m) => ({
        id: m.id,
        content: m.content,
        tags: m.tags,
        source: m.source,
        by: m.createdById ? names.get(m.createdById) ?? "Former member" : null,
        updated: formatRelativeTime(m.updatedAt, workspace.timezone, now),
      }))}
    />
  );
}
