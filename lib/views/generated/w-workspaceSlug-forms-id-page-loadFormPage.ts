// Generated from app/w/[workspaceSlug]/forms/[id]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { listForms, submissions } from "@/lib/forms/service";
import { fieldsSchema } from "@/lib/forms/schema";
import { isAdmin } from "@/lib/approvals/context";

export async function loadFormPage({params}:PageProps<"/w/[workspaceSlug]/forms/[id]">) {
const {workspaceSlug,id}=await params;
const a=await requireWorkspace(workspaceSlug,"MEMBER");
const f=(await listForms(a)).find(f=>f.id===id);
if(!f)notFound();
const fields=fieldsSchema.safeParse(f.fields);
if(!fields.success)notFound();
const inbox=isAdmin(a)?await submissions(a,id):null;
return viewDto({ a, f, fields, inbox } as const);
}
