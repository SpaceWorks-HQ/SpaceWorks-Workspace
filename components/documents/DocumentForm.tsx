"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { documentAction } from "@/app/actions/documents";
import { parseDocumentAmount } from "@/lib/documents/rules";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
export type DocumentField = {
  name: string;
  label: string;
  type?:
    | "textarea"
    | "date"
    | "number"
    | "checkbox"
    | "email"
    | "select"
    | "datetime-local"
    | "money"
    | "percent";
  value?: string | number | boolean;
  required?: boolean;
  helper?: string;
  options?: Array<{ id: string; name: string }>;
};
export function DocumentFields({
  fields,
  errors = {},
}: {
  fields: DocumentField[];
  errors?: Record<string, string[]>;
}) {
  return (
    <>
      {fields.map((f) =>
        f.type === "checkbox" ? (
          <CheckboxField
            key={f.name}
            name={f.name}
            label={f.label}
            description={f.helper}
            defaultChecked={f.value === true}
          />
        ) : (
          <Field
            key={f.name}
            label={f.label}
            optional={!f.required}
            helperText={f.helper}
            error={errors[f.name]?.[0]}
            className={f.type === "textarea" ? "sm:col-span-2" : undefined}
          >
            {f.type === "textarea" ? (
              <Textarea
                name={f.name}
                defaultValue={String(f.value ?? "")}
                maxLength={12000}
                required={f.required}
              />
            ) : f.type === "select" ? (
              <Dropdown
                name={f.name}
                defaultValue={String(f.value ?? "")}
                required={f.required}
              >
                <option value="">Choose an option</option>
                {f.options?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Dropdown>
            ) : (
              <Input
                name={f.name}
                type={
                  f.type === "money"
                    ? "text"
                    : f.type === "percent"
                      ? "number"
                      : (f.type ?? "text")
                }
                inputMode={f.type === "money" ? "decimal" : undefined}
                step={f.type === "percent" ? "0.01" : undefined}
                defaultValue={String(f.value ?? "")}
                required={f.required}
                min={f.type === "number" ? 0 : undefined}
                maxLength={f.type === "date" ? undefined : 1000}
              />
            )}
          </Field>
        ),
      )}
    </>
  );
}
export function DocumentForm({
  slug,
  operation,
  fields = [],
  hidden = {},
  label,
  children,
  redirect = false,
}: {
  slug: string;
  operation: string;
  fields?: DocumentField[];
  hidden?: Record<string, unknown>;
  label: string;
  children?: ReactNode;
  redirect?: boolean;
}) {
  const [pending, start] = useTransition(),
    [message, setMessage] = useState(""),
    [errors, setErrors] = useState<Record<string, string[]>>({});
  const router = useRouter(),
    ref = useRef<HTMLParagraphElement>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const payload: Record<string, unknown> = {
          ...hidden,
          ...Object.fromEntries(form.entries()),
        };
        for (const f of fields) {
          if (f.type === "checkbox")
            payload[f.name] = form.get(f.name) === "on";
          if (f.type === "number") payload[f.name] = Number(form.get(f.name));
          if (f.type === "percent")
            payload[f.name] = Math.round(Number(form.get(f.name)) * 100);
          if (f.type === "money") {
            const n = parseDocumentAmount(
              String(form.get(f.name)),
              String(hidden.currency ?? "INR"),
            );
            if (n === null) {
              setMessage("Enter a valid amount, for example 1250.50.");
              return;
            }
            payload[f.name] = n;
          }
          if (f.type === "datetime-local" && payload[f.name])
            payload[f.name] = new Date(String(payload[f.name])).toISOString();
        }
        form.set("payload", JSON.stringify(payload));
        start(async () => {
          const result = await documentAction(slug, operation, form);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setMessage(result.error);
            ref.current?.focus();
          } else {
            setErrors({});
            setMessage(
              operation === "upload"
                ? `Files saved: ${result.data?.id}`
                : "Saved.",
            );
            if (redirect && result.data?.id)
              router.push(`/w/${slug}/documents/${result.data.id}`);
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <DocumentFields fields={fields} errors={errors} />
      </div>
      {children}
      <p
        ref={ref}
        tabIndex={-1}
        role="status"
        className="break-words text-body-ui"
      >
        {message}
      </p>
      <Button
        type="submit"
        disabled={pending}
        variant={operation === "cancel" ? "dangerSolid" : "primary"}
      >
        {pending ? "Saving" : label}
      </Button>
    </form>
  );
}
export function DocumentUpload({
  slug,
  id = "",
  kind = "SOURCE",
}: {
  slug: string;
  id?: string;
  kind?: string;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [message, setMessage] = useState(""),
    [pending, start] = useTransition();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const accept =
    kind === "IRP_JSON"
      ? "application/json"
      : kind === "PROFILE"
        ? "image/png,image/jpeg,image/webp"
        : "image/*,application/pdf";
  const add = (selected: File[]) => {
    if (files.length + selected.length > 10) {
      setMessage("Choose up to ten files.");
      return;
    }
    setFiles([...files, ...selected]);
  };
  return (
    <div
      className="space-y-3 rounded-xl border border-line bg-panel p-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        add(Array.from(e.dataTransfer.files));
      }}
    >
      <p className="text-body-ui">
        Drop files here or choose them. Images and PDFs, up to 10 MB each and 24
        MB together.
      </p>
      <Field label="Choose files">
        <Input
          ref={input}
          type="file"
          accept={accept}
          multiple
          onChange={(e) => add(Array.from(e.target.files ?? []))}
        />
      </Field>
      {kind !== "IRP_JSON" ? (
        <Field label="Take a photo">
          <Input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => add(Array.from(e.target.files ?? []))}
          />
        </Field>
      ) : null}
      {files.length ? (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex min-w-0 items-center justify-between gap-2"
            >
              <span className="truncate">{f.name}</span>
              <Button
                variant="quiet"
                onClick={() => setFiles(files.filter((_, n) => n !== i))}
                aria-label={`Remove ${f.name}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <p role="status" className="break-words">
        {message}
      </p>
      <Button
        variant="secondary"
        disabled={!files.length || pending}
        onClick={() =>
          start(async () => {
            const data = new FormData();
            data.set("payload", JSON.stringify({ id, kind }));
            files.forEach((f) => data.append("files", f));
            const r = await documentAction(slug, "upload", data);
            setMessage(r.ok ? `Files uploaded. ${r.data?.id ?? ""}` : r.error);
            if (r.ok) {
              setFiles([]);
              if (input.current) input.current.value = "";
              router.refresh();
            }
          })
        }
      >
        {pending ? "Uploading" : "Upload files"}
      </Button>
    </div>
  );
}
