"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategoryAction, renameCategoryAction, setCategoryArchivedAction } from "@/app/actions/finance";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/choice";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import type { LedgerKindValue } from "@/lib/finance/money";

type Category = { id: string; name: string; kind: LedgerKindValue; archived: boolean; entryCount: number };

export function CategoryManager({ slug, categories }: { slug: string; categories: Category[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<LedgerKindValue>("EXPENSE");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        showToast(result.error ?? "Couldn't save. Try again.", "error");
        return;
      }
      showToast(success, "success");
      after?.();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <Card padding="lg" as="section">
        <CardHeader title="Add a category" description="Categories group the ledger and the summary. Income and expense categories are separate lists." />
        <form
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await createCategoryAction(slug, { name, kind });
              if (!result.ok) {
                setError(result.fieldErrors?.name?.[0] ?? result.error);
                return;
              }
              setError(undefined);
              setName("");
              showToast("Category added.", "success");
              router.refresh();
            });
          }}
        >
          <SegmentedControl
            ariaLabel="Category type"
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "EXPENSE", label: "Expense" },
              { value: "INCOME", label: "Income" },
            ]}
            className="self-start sm:self-auto"
          />
          <Field label="Name" error={error} className="flex-1">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={kind === "INCOME" ? "Workshop fees" : "Components and tools"} />
          </Field>
          <Button type="submit" variant="primary" loading={pending} disabled={!name.trim()}>
            Add category
          </Button>
        </form>
      </Card>

      {(["INCOME", "EXPENSE"] as const).map((group) => {
        const list = categories.filter((c) => c.kind === group);
        return (
          <Card key={group} as="section" padding="none">
            <div className="px-5 pt-5">
              <CardHeader title={group === "INCOME" ? "Income categories" : "Expense categories"} />
            </div>
            {list.length === 0 ? (
              <p className="px-5 pb-5 text-body-ui text-ink-muted">None yet.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {list.map((category) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    pending={pending}
                    onRename={(next) => run(() => renameCategoryAction(slug, { categoryId: category.id, name: next }), "Category renamed.")}
                    onArchive={(archived) => run(() => setCategoryArchivedAction(slug, { categoryId: category.id, archived }), archived ? "Category archived. Its entries keep it." : "Category restored.")}
                  />
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function CategoryRow({ category, pending, onRename, onArchive }: { category: Category; pending: boolean; onRename: (name: string) => void; onArchive: (archived: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(category.name);
  return (
    <li className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-2">
      {editing ? (
        <form
          className="flex flex-1 flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() && value.trim() !== category.name) onRename(value.trim());
            setEditing(false);
          }}
        >
          <Input aria-label={`New name for ${category.name}`} value={value} onChange={(event) => setValue(event.target.value)} maxLength={60} className="max-w-xs" autoFocus />
          <Button type="submit" variant="primary" size="sm">
            Save
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <span className={category.archived ? "text-body-ui text-ink-muted" : "text-body-ui text-ink"}>{category.name}</span>
          {category.archived ? <Chip size="sm" tone="outline">Archived</Chip> : null}
          <span className="text-caption text-ink-muted">{category.entryCount === 1 ? "1 entry" : `${category.entryCount} entries`}</span>
        </div>
      )}
      {editing ? null : (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} disabled={pending}>
            Rename
          </Button>
          <Button variant="quiet" size="sm" onClick={() => onArchive(!category.archived)} disabled={pending}>
            {category.archived ? "Restore" : "Archive"}
          </Button>
        </div>
      )}
    </li>
  );
}
