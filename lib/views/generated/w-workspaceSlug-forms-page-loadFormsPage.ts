// Generated from app/w/[workspaceSlug]/forms/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { listForms } from "@/lib/forms/service";

export async function loadFormsPage({params}:PageProps<"/w/[workspaceSlug]/forms">) {
const {workspaceSlug}=await params;
const a=await requireWorkspace(workspaceSlug,"MEMBER");
if(!canContribute(a.membership))notFound();
const forms=await listForms(a);
return viewDto({ a, forms } as const);
}
