"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { governanceOperation } from "@/app/actions/governance";
import type { Choices } from "@/lib/governance/fields";
import { Controls } from "./RecordControls";

export function AgmForm({
  slug,
  choices,
}: { slug: string; choices: Choices }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          try {
            const r = await governanceOperation(slug, {
              op: "agm",
              parentId: fd.get("parentId"),
              year: fd.get("year"),
              dueOn: fd.get("dueOn"),
            });
            setMessage(r.ok ? "Checklist ready." : r.error);
            router.refresh();
          } catch {
            setMessage("Couldn't save. Try again.");
          }
        });
      }}
    >
      <Controls
        fields={[
          {
            name: "parentId",
            label: "Board or committee",
            type: "select",
            options: choices.committees,
            required: true,
          },
          {
            name: "year",
            label: "AGM year",
            value: new Date().getFullYear(),
            required: true,
          },
          { name: "dueOn", label: "Due date", type: "date", required: true },
        ]}
      />
      <Button variant="secondary" type="submit" disabled={pending}>
        {pending ? "Adding" : "Add AGM checklist"}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
