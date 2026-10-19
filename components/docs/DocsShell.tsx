"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Plus, Search } from "lucide-react";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { RealtimeEvent } from "@/lib/realtimeTypes";
import { DocTree, type TreeItem } from "./DocTree";
import { NewDocDialog, type TemplateOption } from "./NewDocDialog";

type Listener = (event: RealtimeEvent) => void;
type DocsContextValue = {
  slug: string;
  canCreate: boolean;
  isAdmin: boolean;
  tree: TreeItem[];
  templates: TemplateOption[];
  /** Subscribe to the workspace realtime stream (one connection per docs view). */
  subscribe: (listener: Listener) => () => void;
  openNewDoc: (parentId?: string | null) => void;
};

const DocsContext = createContext<DocsContextValue | null>(null);

export function useDocs() {
  const value = useContext(DocsContext);
  if (!value) throw new Error("useDocs must be used inside DocsShell.");
  return value;
}

/**
 * Docs area frame: the page tree on the left (a disclosure above the page on
 * small screens), the page on the right. Owns the one realtime connection of
 * the docs view: tree changes refresh the server-rendered tree, and pages
 * subscribe for their own `doc:<id>` events.
 */
export function DocsShell({ slug, tree, canCreate, isAdmin, templates, children }: { slug: string; tree: TreeItem[]; canCreate: boolean; isAdmin: boolean; templates: TemplateOption[]; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const listeners = useRef(new Set<Listener>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newDoc, setNewDoc] = useState<{ open: boolean; parentId: string | null }>({ open: false, parentId: null });
  const activeId = pathname.match(/\/docs\/([^/]+)/)?.[1] ?? null;
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMobileOpen(false);
  }

  useRealtime(slug, (event) => {
    if (event.type === "docs.tree_changed") {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    }
    for (const listener of listeners.current) listener(event);
  });
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const openNewDoc = useCallback((parentId: string | null = null) => setNewDoc({ open: true, parentId }), []);

  const sidebar = (
    <nav aria-label="Pages" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Link href={`/w/${slug}/docs`} className="min-h-11 flex-1 content-center rounded-md px-2 text-label text-ink hover:bg-muted">
          All docs
        </Link>
        <Link href={`/w/${slug}/docs?focus=search`} aria-label="Search docs" title="Search docs" className="inline-flex size-11 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink [&_svg]:size-[18px]">
          <Search aria-hidden />
        </Link>
      </div>
      {canCreate ? (
        <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => openNewDoc(null)} fullWidth>
          New page
        </Button>
      ) : null}
      <DocTree slug={slug} items={tree} activeId={activeId} canEdit={canCreate} onAddChild={(parentId) => openNewDoc(parentId)} />
      <Link href={`/w/${slug}/docs/archived`} className="min-h-11 content-center rounded-md px-2 text-caption text-ink-muted hover:bg-muted hover:text-ink">
        Archived pages
      </Link>
    </nav>
  );

  return (
    <DocsContext.Provider value={{ slug, canCreate, isAdmin, tree, templates, subscribe, openNewDoc }}>
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        <div className="md:hidden">
          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="docs-mobile-tree"
            onClick={() => setMobileOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between rounded-md border border-line bg-panel px-4 text-label text-ink"
          >
            Pages
            <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", mobileOpen && "rotate-180")} />
          </button>
          {mobileOpen ? (
            <div id="docs-mobile-tree" className="mt-2 rounded-xl border border-line bg-panel p-3">
              {sidebar}
            </div>
          ) : null}
        </div>
        <aside className="hidden w-[260px] shrink-0 md:sticky md:top-6 md:block md:max-h-[calc(100dvh-48px)] md:overflow-y-auto">{sidebar}</aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <NewDocDialog
        slug={slug}
        open={newDoc.open}
        parentId={newDoc.parentId}
        parentTitle={newDoc.parentId ? tree.find((item) => item.id === newDoc.parentId)?.title ?? null : null}
        templates={templates}
        onOpenChange={(open) => setNewDoc((state) => ({ ...state, open }))}
      />
    </DocsContext.Provider>
  );
}
