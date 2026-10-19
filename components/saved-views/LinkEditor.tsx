"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLink } from "@/app/actions/links";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
export function LinkEditor({
  slug,
  link,
}: {
  slug: string;
  link?: {
    id: string;
    title: string;
    url: string;
    description: string | null;
    tags: string[];
  };
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <details className="rounded-xl border border-line bg-panel p-5">
      <summary className="min-h-11 cursor-pointer text-title">
        {link ? "Edit link" : "Add a link"}
      </summary>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          start(async () => {
            try {
              const r = await saveLink(slug, {
                id: link?.id,
                title: f.get("title"),
                url: f.get("url"),
                description: f.get("description"),
                tags: String(f.get("tags") ?? "")
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              });
              setMessage(r.ok ? "Link saved." : r.error);
              if (r.ok) {
                if (!link) form.reset();
                router.refresh();
              }
            } catch {
              setMessage("Couldn't save the link. Try again.");
            }
          });
        }}
      >
        <Field label="Title" required>
          <Input name="title" defaultValue={link?.title} maxLength={200} />
        </Field>
        <Field label="URL" required>
          <Input
            name="url"
            type="url"
            defaultValue={link?.url}
            maxLength={2000}
          />
        </Field>
        <Field label="Description" optional>
          <Textarea
            name="description"
            defaultValue={link?.description ?? ""}
            maxLength={1000}
          />
        </Field>
        <Field label="Tags" optional helperText="Separate tags with commas.">
          <Input
            name="tags"
            defaultValue={link?.tags.join(", ")}
            maxLength={500}
          />
        </Field>
        <Button type="submit" loading={pending}>
          Save link
        </Button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
