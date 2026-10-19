"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/field";
import { useDocs } from "./DocsShell";

export function NewPageButton({ label = "New page", variant = "primary" }: { label?: string; variant?: "primary" | "secondary" }) {
  const { canCreate, openNewDoc } = useDocs();
  if (!canCreate) return null;
  return (
    <Button variant={variant} startIcon={<Plus />} onClick={() => openNewDoc(null)}>
      {label}
    </Button>
  );
}

/** GET search form for docs (`?q=`); focuses itself when opened from the tree's search button. */
export function DocsSearch({ query, autoFocus }: { query: string; autoFocus: boolean }) {
  const router = useRouter();
  const { slug } = useDocs();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(query);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  return (
    <form role="search" action={`/w/${slug}/docs`} className="max-w-[560px]">
      <label htmlFor="docs-search" className="sr-only">Search docs</label>
      <SearchInput
        ref={input}
        id="docs-search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search page titles and text"
        onClear={() => {
          setValue("");
          router.push(`/w/${slug}/docs`);
        }}
      />
    </form>
  );
}
