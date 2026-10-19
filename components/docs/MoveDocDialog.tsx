"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveDocAction } from "@/app/actions/docs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field } from "@/components/ui/field";
import { buildDocTree, descendantIds, flattenTree } from "@/lib/docs/tree";
import type { TreeItem } from "./DocTree";

const TOP = "__top";

/** Keyboard-friendly alternative to dragging: pick a new parent page (never the page itself or its sub-pages). */
export function MoveDocDialog({ slug, item, items, onClose }: { slug: string; item: TreeItem | null; items: TreeItem[]; onClose: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const options = useMemo(() => {
    if (!item) return [];
    const blocked = descendantIds(items, item.id);
    blocked.add(item.id);
    return flattenTree(buildDocTree(items)).filter(({ node }) => !blocked.has(node.id));
  }, [item, items]);
  const value = target ?? item?.parentId ?? TOP;

  const submit = () => {
    if (!item) return;
    const parentId = value === TOP ? null : value;
    const index = items.filter((other) => other.parentId === parentId && other.id !== item.id).length;
    startTransition(async () => {
      const result = await moveDocAction(slug, { docId: item.id, parentId, index });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast("Page moved.", "success");
      setTarget(null);
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setTarget(null);
          onClose();
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader title={`Move ${item?.title ?? "page"}`} description="Its sub-pages move with it. It goes to the end of the new list." />
        <DialogBody>
          <Field label="Put it inside">
            <Dropdown value={value} onChange={(event) => setTarget(event.target.value)}>
              <option value={TOP}>Top level</option>
              {options.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>{`${"  ".repeat(depth)}${depth ? "› " : ""}${node.title}`}</option>
              ))}
            </Dropdown>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={pending} loadingLabel="Moving…">Move page</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
