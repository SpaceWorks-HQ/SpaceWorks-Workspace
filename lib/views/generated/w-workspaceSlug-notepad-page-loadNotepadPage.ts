// Generated from app/w/[workspaceSlug]/notepad/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getNotepad } from "@/lib/notepad/service";
import { requireWorkspace } from "@/lib/permissions";

export async function loadNotepadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/notepad">) {
const { workspaceSlug } = await params;
const { note } = await searchParams;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const data = await getNotepad(context);
const openId = typeof note === "string" && [...data.notes, ...data.archivedNotes].some((item) => item.id === note) ? note : null;
return viewDto({ context, data, openId } as const);
}
