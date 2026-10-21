"use client";

import type { DraftInput } from "@/lib/documents/rules";
import type { EditorOptions } from "@/lib/documents/types";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { useDocumentDraft } from "./useDocumentDraft";
import { DocumentIdentityFields } from "./DocumentIdentityFields";
import { DocumentLineItems } from "./DocumentLineItems";
import { DocumentPurposeFields } from "./DocumentPurposeFields";

export function DocumentEditor({
  slug,
  initial,
  options,
}: {
  slug: string;
  initial: DraftInput;
  options: EditorOptions;
}) {
  const draft = useDocumentDraft(slug, initial, options);
  const { formRef, errorRef, message, pending, onSubmit } = draft;
  return (
    <form
      ref={formRef}
      className="space-y-5"
      onSubmit={onSubmit}
    >
      <DocumentIdentityFields draft={draft} />
      <DocumentLineItems draft={draft} />
      <DocumentPurposeFields draft={draft} />
      <Field label="Notes and terms">
        <Textarea name="notes" defaultValue={initial.notes} maxLength={12000} />
      </Field>
      <CheckboxField
        name="reviewed"
        label="I reviewed classification, required fields, source facts and signing authority"
        defaultChecked={initial.reviewed}
      />
      <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger-fg">
        {message}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save draft"}
      </Button>
      <p className="text-caption text-ink-muted">
        Save first, attach evidence, then review and issue the frozen copy.
      </p>
    </form>
  );
}
