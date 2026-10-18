"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminCreateWorkspace } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/display";
import { Field, Input, PrefixInput } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { slugify } from "@/lib/slug";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState({ name: "", slug: "", ownerEmail: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader title="New workspace" description="For another community or chapter. The owner gets an invitation if they don't have an account yet." />
      <form
        className="grid gap-4 md:grid-cols-3 md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await adminCreateWorkspace(values);
            if (!result.ok) {
              setErrors(result.fieldErrors ?? {});
              showToast(result.error, "error");
              return;
            }
            setErrors({});
            setValues({ name: "", slug: "", ownerEmail: "" });
            setSlugEdited(false);
            showToast(result.data?.invited ? "Workspace created and the owner invited." : "Workspace created.", "success");
            router.refresh();
          });
        }}
      >
        <Field label="Name" error={errors.name?.[0]}>
          <Input value={values.name} maxLength={80} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value, slug: slugEdited ? v.slug : slugify(e.target.value, "") }))} />
        </Field>
        <Field label="Address" error={errors.slug?.[0]}>
          <PrefixInput prefix="/w/" value={values.slug} maxLength={60} onChange={(e) => { setSlugEdited(true); setValues((v) => ({ ...v, slug: e.target.value.toLowerCase() })); }} />
        </Field>
        <Field label="Owner email" error={errors.ownerEmail?.[0]}>
          <Input type="email" value={values.ownerEmail} onChange={(e) => setValues((v) => ({ ...v, ownerEmail: e.target.value }))} />
        </Field>
        <Button type="submit" variant="primary" loading={pending} className="md:col-span-3 md:justify-self-start">Create workspace</Button>
      </form>
    </Card>
  );
}
