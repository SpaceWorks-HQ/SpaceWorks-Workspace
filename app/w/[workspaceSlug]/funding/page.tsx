import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/funding">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "ADMIN");
  redirect(`/w/${workspaceSlug}/funding/tracker`);
}
