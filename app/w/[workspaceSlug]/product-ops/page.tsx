import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/product-ops">) {
 const {workspaceSlug}=await params;
 await requireWorkspace(workspaceSlug,"MEMBER");
 redirect(`/w/${workspaceSlug}/product-ops/roadmap`);
}
