"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export function QuickAdd({ onCreate }: { onCreate: (title: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button variant="quiet" size="sm" startIcon={<Plus />} onClick={() => setOpen(true)} className="justify-start">
        Add task
      </Button>
    );
  }
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        const ok = await onCreate(title.trim());
        setBusy(false);
        if (ok) setTitle("");
      }}
      className="flex flex-col gap-2"
    >
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={200}
        placeholder="Task title, then Enter"
        aria-label="New task title"
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!title.trim()}>
          Add
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </form>
  );
}
