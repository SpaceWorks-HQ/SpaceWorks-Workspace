import { EditorForm } from "@/components/people/AreaForms";
import { mutateContacts } from "@/app/actions/contacts";
import { accessFields } from "./RelationshipViews";
import type { FormField } from "@/components/people/AreaForms";

type Access = { ownerId: string | null; teamId: string | null; visibility: string; tags: string[]; notesMd: string | null };
type Choices = { teams: { id: string; name: string }[]; members: { id: string; name: string }[] };
export function ContactEditor({ slug, teams, members, organisations, contact }: Choices & { slug: string; organisations: { id: string; name: string }[]; contact?: Access & { id: string; displayName: string; email: string; phone: string; sensitivePhone: boolean; kinds: string[]; doNotContact: boolean; nextFollowUpAt: Date | null } }) {
  const fields: FormField[] = [
    { name: "displayName", label: "Name", required: true, value: contact?.displayName, maxLength: 160 },
    { name: "email", label: "Email", type: "email", value: contact?.email },
    { name: "phone", label: "Phone", value: contact?.phone, maxLength: 60 },
    { name: "sensitivePhone", label: "Phone visible only to owner and admins", type: "checkbox", value: contact?.sensitivePhone },
    { name: "kinds", label: "Contact kinds", parse: "tags", value: contact?.kinds.join(", "), helper: "For example: mentor, press, speaker. Separate kinds with commas." },
    { name: "organisationId", label: "Link an organisation", type: "select", parse: "nullable", options: [{ value: "", label: "Keep existing links" }, ...organisations.map(o => ({ value: o.id, label: o.name }))] },
    { name: "nextFollowUpAt", label: "Next follow-up", type: "date", parse: "iso", value: contact?.nextFollowUpAt?.toISOString().slice(0, 10) },
    { name: "doNotContact", label: "Do not contact", type: "checkbox", value: contact?.doNotContact },
    ...accessFields(teams, members, contact),
  ];
  return <EditorForm action={mutateContacts.bind(null, slug, "contact")} fixed={{ id: contact?.id }} fields={fields} />;
}
export function OrganisationEditor({ slug, teams, members, organisation }: Choices & { slug: string; organisation?: Access & { id: string; name: string; website: string | null; address: string | null; kinds: string[]; status: string } }) {
  return <EditorForm action={mutateContacts.bind(null, slug, "organisation")} fixed={{ id: organisation?.id }} label={organisation ? "Save organisation" : "Create organisation"} resetOnSuccess={!organisation} fields={[
    { name: "name", label: "Organisation name", required: true, value: organisation?.name, maxLength: 160 },
    { name: "website", label: "Website", value: organisation?.website ?? "", helper: "Include https://." },
    { name: "kinds", label: "Relationship kinds", type: "choices", value: organisation?.kinds ?? [], options: ["SPONSOR", "PARTNER", "VENDOR", "VENUE", "UNIVERSITY", "GOVERNMENT", "MEDIA", "COMMUNITY", "DONOR", "OTHER"].map(value => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() })) },
    { name: "address", label: "Address", type: "textarea", value: organisation?.address ?? "", maxLength: 1000 },
    { name: "status", label: "Relationship status", type: "select", value: organisation?.status ?? "ACTIVE", options: [{ value: "PROSPECT", label: "Prospect" }, { value: "ACTIVE", label: "Active" }, { value: "DORMANT", label: "Dormant" }, { value: "DO_NOT_CONTACT", label: "Do not contact" }] },
    ...accessFields(teams, members, organisation),
  ]} />;
}
