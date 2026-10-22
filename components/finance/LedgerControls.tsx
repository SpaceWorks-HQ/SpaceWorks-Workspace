"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis as MoreHorizontal } from "lucide-react";
import { setLedgerEntryVoidedAction } from "@/app/actions/finance";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { LedgerEntryDialog, type BudgetOption, type CategoryOption, type EditableEntry } from "@/components/finance/LedgerEntryDialog";

type Shared = { slug: string; currency: string; today: string; categories: CategoryOption[]; budgets: BudgetOption[] };

/** "Record entry" plus import/export links; opens itself when the URL asks (?new=1). */
export function LedgerToolbar({ shared, exportHref, importHref, startOpen }: { shared: Shared; exportHref: string; importHref: string | null; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button asChild variant="secondary">
        <a href={exportHref} download>
          Export CSV
        </a>
      </Button>
      {importHref ? (
        <>
          <Button asChild variant="secondary">
            <Link href={importHref}>Import CSV</Link>
          </Button>
          <Button variant="primary" onClick={() => setOpen(true)}>
            Record entry
          </Button>
          {open ? <LedgerEntryDialog {...shared} open={open} onOpenChange={setOpen} /> : null}
        </>
      ) : null}
    </div>
  );
}

export function LedgerRowActions({ shared, entry, voided }: { shared: Shared; entry: EditableEntry; voided: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const setVoided = (next: boolean) =>
    startTransition(async () => {
      const result = await setLedgerEntryVoidedAction(shared.slug, { entryId: entry.id, voided: next });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setConfirming(false);
      showToast(next ? "Entry voided. It no longer counts towards the kitty." : "Entry restored.", "success");
      router.refresh();
    });

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={`Actions for ${entry.description}`} size="sm">
            <MoreHorizontal />
          </IconButton>
        </MenuTrigger>
        <MenuContent align="end">
          {voided ? (
            entry.linkedLabel ? null : (
              <MenuItem icon={null} onSelect={() => setVoided(false)}>
                Restore entry
              </MenuItem>
            )
          ) : (
            <>
              <MenuItem icon={null} onSelect={() => setEditing(true)}>
                Edit
              </MenuItem>
              {entry.linkedLabel ? null : (
                <MenuItem icon={null} danger onSelect={() => setConfirming(true)}>
                  Void…
                </MenuItem>
              )}
            </>
          )}
          {voided && entry.linkedLabel ? <MenuItem disabled>Change it from its source</MenuItem> : null}
        </MenuContent>
      </Menu>
      {editing ? <LedgerEntryDialog {...shared} entry={entry} open={editing} onOpenChange={setEditing} /> : null}
      <ConfirmDialog
        open={confirming}
        title="Void this entry?"
        message="It stays in the ledger, struck through, and stops counting towards the kitty. You can restore it later."
        confirmLabel="Void entry"
        loading={pending}
        onConfirm={() => setVoided(true)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
