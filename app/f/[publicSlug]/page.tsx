import { notFound } from "next/navigation";
import { publicForm } from "@/lib/forms/service";
import { fieldsSchema } from "@/lib/forms/schema";
import { sendPublicResponse } from "@/app/actions/forms";
import { Intake } from "@/components/forms/Intake";
import { Card } from "@/components/ui/display";
export const metadata={title:"Space Works form",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function PublicFormPage({params}:PageProps<"/f/[publicSlug]">){
 const {publicSlug}=await params;const form=await publicForm(publicSlug);if(!form)notFound();const fields=fieldsSchema.safeParse(form.fields);if(!fields.success)notFound();
 return <main className="mx-auto min-w-0 max-w-2xl space-y-6 break-words p-5 sm:p-8"><header><p className="text-label text-accent-text">Space Works</p><h1 className="mt-3 text-h1">{form.title}</h1><p className="mt-3 text-body-ui text-ink-muted">{form.description}</p></header><Card>{form.closesAt&&form.closesAt<=new Date()?<p>This form is closed.</p>:<Intake fields={fields.data} action={sendPublicResponse.bind(null,publicSlug)} />}</Card></main>;
}
