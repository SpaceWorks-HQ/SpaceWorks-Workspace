// Generated from app/f/[publicSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { publicForm } from "@/lib/forms/service";
import { fieldsSchema } from "@/lib/forms/schema";

export async function loadPublicFormPage({params}:PageProps<"/f/[publicSlug]">) {
const {publicSlug}=await params;
const form=await publicForm(publicSlug);
if(!form)notFound();
const fields=fieldsSchema.safeParse(form.fields);
if(!fields.success)notFound();
return viewDto({ form, fields } as const);
}
