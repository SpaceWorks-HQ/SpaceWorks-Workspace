"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { archiveDocAction, duplicateDocAction, setDocVisibilityAction, verifyDocAction } from "@/app/actions/docs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { RadioGroup, Radio } from "@/components/ui/choice";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { VERIFY_PERIOD_DAYS } from "@/lib/docs/rules";
import { useDocs } from "./DocsShell";
import { MoveDocDialog } from "./MoveDocDialog";
import type { DocView } from "./DocEditor";

const PERIOD_LABEL: Record<number, string> = { 30: "30 days", 90: "3 months", 180: "6 months", 365: "1 year" };

/** The doc page's "More" menu: share, structure, review, export, archive. */
export function DocActions({ doc, title, canEdit, canArchive, isAdmin }: { doc: DocView; title: string; canEdit: boolean; canArchive: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { slug, tree, openNewDoc } = useDocs();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"move" | "verify" | "archive" | "visibility" | null>(null);
  const [period, setPeriod] = useState("90");

  const run = <T,>(action: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>, success: string, after?: (data: T | undefined) => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setDialog(null);
      showToast(success, "success");
      if (after) after(result.data);
      else router.refresh();
    });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/w/${slug}/docs/${doc.id}`);
      showToast("Link copied. Only members of this workspace can open it.", "success");
    } catch {
      showToast("Couldn't copy the link. Copy it from the address bar.", "error");
    }
  };

  const treeItem = tree.find((item) => item.id === doc.id) ?? { id: doc.id, parentId: doc.parentId, title, position: 0, visibility: doc.visibility };
  const toAdmins = doc.visibility === "WORKSPACE";

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label="Page actions" variant="secondary" size="sm"><Ellipsis /></IconButton>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={copyLink}>Copy link</MenuItem>
          {canEdit ? <MenuItem onSelect={() => openNewDoc(doc.id)}>Add a sub-page</MenuItem> : null}
          {canEdit ? <MenuItem onSelect={() => run(() => duplicateDocAction(slug, { docId: doc.id }), "Page duplicated.", (data) => data && router.push(`/w/${slug}/docs/${(data as { id: string }).id}`))}>Duplicate</MenuItem> : null}
          {canEdit ? <MenuItem onSelect={() => setDialog("move")}>Move to…</MenuItem> : null}
          <MenuItem onSelect={() => router.push(`/w/${slug}/docs/${doc.id}/history`)}>Version history</MenuItem>
          {canEdit ? <MenuItem onSelect={() => setDialog("verify")}>Verify…</MenuItem> : null}
          {isAdmin ? <MenuItem onSelect={() => setDialog("visibility")}>{toAdmins ? "Make admin-only…" : "Share with everyone…"}</MenuItem> : null}
          <MenuSeparator />
          <MenuItem asChild><a href={`/w/${slug}/docs/${doc.id}/export?format=md`} download>Export as Markdown</a></MenuItem>
          <MenuItem asChild><a href={`/w/${slug}/docs/${doc.id}/export?format=html`} download>Export as HTML</a></MenuItem>
          {canArchive ? (
            <>
              <MenuSeparator />
              <MenuItem danger onSelect={() => setDialog("archive")}>Archive…</MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>

      <MoveDocDialog slug={slug} item={dialog === "move" ? treeItem : null} items={tree} onClose={() => setDialog(null)} />

      <Dialog open={dialog === "verify"} onOpenChange={(open) => !open && !pending && setDialog(null)}>
        <DialogContent size="sm">
          <DialogHeader title="Verify this page" description="Confirm it is accurate. You become its review owner, and it shows Needs review when the time is up." />
          <DialogBody>
            <RadioGroup value={period} onValueChange={setPeriod} aria-label="Verified for">
              {VERIFY_PERIOD_DAYS.map((days) => (
                <Radio key={days} value={String(days)} label={`For ${PERIOD_LABEL[days]}`} />
              ))}
            </RadioGroup>
          </DialogBody>
          <DialogFooter>
            {doc.verification.state !== "none" ? (
              <Button variant="dangerQuiet" disabled={pending} onClick={() => run(() => verifyDocAction(slug, { docId: doc.id, days: null }), "Verification cleared.")}>
                Clear verification
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => run(() => verifyDocAction(slug, { docId: doc.id, days: Number(period) }), "Page verified.")}>
              Verify page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dialog === "visibility"}
        destructive={false}
        title={toAdmins ? "Make this page admin-only?" : "Share this page with everyone?"}
        message={
          toAdmins
            ? "Only owners and admins will see it, its sub-pages and their files. Members and guests lose access straight away."
            : "Every member and guest will be able to read it. Its sub-pages keep their own setting."
        }
        confirmLabel={toAdmins ? "Make admin-only" : "Share with everyone"}
        loading={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => run(() => setDocVisibilityAction(slug, { docId: doc.id, visibility: toAdmins ? "ADMINS" : "WORKSPACE" }), toAdmins ? "Page is now admin-only." : "Page is shared with everyone.")}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        title={`Archive ${title || "this page"}?`}
        message="It and its sub-pages leave the tree and search. You can restore them from Archived pages."
        confirmLabel="Archive page"
        loading={pending}
        onCancel={() => setDialog(null)}
        onConfirm={() => run(() => archiveDocAction(slug, { docId: doc.id }), "Page archived.", () => router.push(`/w/${slug}/docs`))}
      />
    </>
  );
}
