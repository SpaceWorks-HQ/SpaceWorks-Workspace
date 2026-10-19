"use client";

import { useMemo, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Ellipsis, Plus } from "lucide-react";
import { moveDocAction } from "@/app/actions/docs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { ancestorIds, buildDocTree, descendantIds, type TreeNode } from "@/lib/docs/tree";
import { MoveDocDialog } from "./MoveDocDialog";

export type TreeItem = { id: string; parentId: string | null; title: string; position: number; visibility: "WORKSPACE" | "ADMINS" };
type Node = TreeNode<TreeItem>;
type DropZone = { id: string; zone: "before" | "inside" | "after" } | null;

/**
 * Nested page tree. Each row links to its page; a disclosure button shows
 * sub-pages. Editors can drag a page onto another (inside) or between rows
 * (before/after), or use the row menu (Move up, Move down, Move to…) from
 * the keyboard.
 */
export function DocTree({ slug, items, activeId, canEdit, onAddChild }: { slug: string; items: TreeItem[]; activeId: string | null; canEdit: boolean; onAddChild: (parentId: string) => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const tree = useMemo(() => buildDocTree(items), [items]);
  // Pages the viewer opened or closed; otherwise the current page's ancestors are open.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const ancestors = useMemo(() => new Set(activeId ? ancestorIds(items, activeId) : []), [activeId, items]);
  const isOpen = (id: string) => toggled.get(id) ?? ancestors.has(id);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropZone>(null);
  const [moving, setMoving] = useState<TreeItem | null>(null);

  const toggle = (id: string) => setToggled((current) => new Map(current).set(id, !isOpen(id)));

  const move = (docId: string, parentId: string | null, index: number) =>
    startTransition(async () => {
      const result = await moveDocAction(slug, { docId, parentId, index });
      if (!result.ok) showToast(result.error, "error");
      else {
        if (parentId) setToggled((current) => new Map(current).set(parentId, true));
        router.refresh();
      }
    });

  const siblingsOf = (item: TreeItem) => items.filter((other) => other.parentId === item.parentId).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));

  const onDrop = (event: DragEvent, target: Node) => {
    event.preventDefault();
    const docId = dragging ?? event.dataTransfer.getData("application/x-sw-doc");
    const zone = drop?.id === target.id ? drop.zone : "inside";
    setDrop(null);
    setDragging(null);
    if (!docId || docId === target.id || descendantIds(items, docId).has(target.id)) return;
    if (zone === "inside") {
      const children = items.filter((other) => other.parentId === target.id && other.id !== docId);
      move(docId, target.id, children.length);
      return;
    }
    const siblings = siblingsOf(target).filter((other) => other.id !== docId);
    const index = siblings.findIndex((other) => other.id === target.id) + (zone === "after" ? 1 : 0);
    move(docId, target.parentId, index);
  };

  const renderNodes = (nodes: Node[], depth: number) => (
    <ul role={depth === 0 ? undefined : "group"} className="flex flex-col">
      {nodes.map((node) => {
        const open = isOpen(node.id);
        const active = node.id === activeId;
        const zone = drop?.id === node.id ? drop.zone : null;
        const siblings = siblingsOf(node);
        const position = siblings.findIndex((other) => other.id === node.id);
        return (
          <li key={node.id}>
            <div
              className={cn(
                "group relative flex min-h-10 items-center rounded-md transition-colors duration-[120ms]",
                active ? "bg-sidebar-active text-on-sidebar-active" : "text-ink-secondary hover:bg-muted hover:text-ink",
                zone === "inside" && "outline outline-2 outline-offset-[-2px] outline-[var(--yy-focus)]",
                dragging === node.id && "opacity-60",
              )}
              style={{ paddingLeft: depth * 14 }}
              draggable={canEdit && !pending}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-sw-doc", node.id);
                event.dataTransfer.effectAllowed = "move";
                setDragging(node.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDrop(null);
              }}
              onDragOver={(event) => {
                if (!dragging || dragging === node.id) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const y = (event.clientY - rect.top) / rect.height;
                const next = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
                if (drop?.id !== node.id || drop.zone !== next) setDrop({ id: node.id, zone: next });
              }}
              onDragLeave={() => setDrop((current) => (current?.id === node.id ? null : current))}
              onDrop={(event) => onDrop(event, node)}
            >
              {zone === "before" ? <span aria-hidden className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-[var(--yy-focus)]" /> : null}
              {zone === "after" ? <span aria-hidden className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--yy-focus)]" /> : null}
              {node.children.length > 0 ? (
                <button
                  type="button"
                  aria-label={`${open ? "Hide" : "Show"} sub-pages of ${node.title}`}
                  aria-expanded={open}
                  onClick={() => toggle(node.id)}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4"
                >
                  <ChevronRight aria-hidden className={cn("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} />
                </button>
              ) : (
                <span aria-hidden className="inline-block w-8 shrink-0" />
              )}
              <Link
                href={`/w/${slug}/docs/${node.id}`}
                aria-current={active ? "page" : undefined}
                className={cn("min-w-0 flex-1 truncate py-2 pr-1 text-label", active && "font-semibold")}
                title={node.title}
              >
                {node.title}
                {node.visibility === "ADMINS" ? <span className="ml-1.5 text-caption">· Admins</span> : null}
              </Link>
              {canEdit ? (
                <span className={cn("flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100", active && "opacity-100")}>
                  <button
                    type="button"
                    aria-label={`Add a sub-page to ${node.title}`}
                    title="Add a sub-page"
                    onClick={() => onAddChild(node.id)}
                    className="inline-flex size-8 items-center justify-center rounded-md hover:bg-emphasis [&_svg]:size-4"
                  >
                    <Plus aria-hidden />
                  </button>
                  <Menu>
                    <MenuTrigger asChild>
                      <button type="button" aria-label={`More for ${node.title}`} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-emphasis [&_svg]:size-4">
                        <Ellipsis aria-hidden />
                      </button>
                    </MenuTrigger>
                    <MenuContent align="start">
                      <MenuItem onSelect={() => onAddChild(node.id)}>Add a sub-page</MenuItem>
                      <MenuItem disabled={position <= 0} onSelect={() => move(node.id, node.parentId, position - 1)}>Move up</MenuItem>
                      <MenuItem disabled={position >= siblings.length - 1} onSelect={() => move(node.id, node.parentId, position + 1)}>Move down</MenuItem>
                      <MenuItem onSelect={() => setMoving(node)}>Move to…</MenuItem>
                    </MenuContent>
                  </Menu>
                </span>
              ) : null}
            </div>
            {node.children.length > 0 && open ? renderNodes(node.children, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );

  if (tree.length === 0) {
    return <p className="px-2 text-caption text-ink-muted">No pages yet.</p>;
  }

  return (
    <>
      {renderNodes(tree, 0)}
      {canEdit ? (
        <div
          aria-hidden
          className={cn("h-6 rounded-md", drop?.id === "__root" && "bg-accent-soft")}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            setDrop({ id: "__root", zone: "after" });
          }}
          onDragLeave={() => setDrop(null)}
          onDrop={(event) => {
            event.preventDefault();
            const docId = dragging;
            setDrop(null);
            setDragging(null);
            if (docId) move(docId, null, items.filter((item) => item.parentId === null && item.id !== docId).length);
          }}
        />
      ) : null}
      <MoveDocDialog slug={slug} item={moving} items={items} onClose={() => setMoving(null)} />
    </>
  );
}
