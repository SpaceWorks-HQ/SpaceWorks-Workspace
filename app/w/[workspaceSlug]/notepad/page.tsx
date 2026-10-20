import { Notepad } from "@/components/notepad/Notepad";
import { PageHeader } from "@/components/ui/display";
import { getNotepad } from "@/lib/notepad/service";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute } from "@/lib/roles";

export const metadata = { title: "Notepad" };

export default async function NotepadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/notepad">) {
  const { workspaceSlug } = await params;
  const { note } = await searchParams;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const data = await getNotepad(context);
  const openId = typeof note === "string" && [...data.notes, ...data.archivedNotes].some((item) => item.id === note) ? note : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Notepad" description="Your own to-dos and notes for this workspace. Only you can see them." />
      <Notepad slug={context.workspace.slug} timeZone={context.workspace.timezone} initial={data} initialOpenId={openId} canSendToTasks={canContribute(context.membership)} />
    </div>
  );
}
