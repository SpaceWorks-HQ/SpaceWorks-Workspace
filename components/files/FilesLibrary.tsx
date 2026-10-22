"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Chip, EmptyState } from "@/components/ui/display";
import { Field, Input, SearchInput } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { FILE_KIND_LABEL, fileKind, formatBytes, joinFolder } from "@/lib/files/versions";
import { DeleteFileDialog, MoveFilesDialog, RenameFileDialog } from "./FileDialogs";
import { FileFolderBreadcrumbs } from "./FileFolderBreadcrumbs";
import { LibraryFileMenu } from "./LibraryFileMenu";
import { UploadConflictDialog } from "./UploadConflictDialog";
import { UploadQueue } from "./UploadQueue";
import { useUploads, type UploadJob } from "./useUploads";

export type LibraryFile = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  folder: string;
  version: number;
  uploadedBy: string;
  updated: string;
  canDelete: boolean;
};

type Props = {
  slug: string;
  folder: string;
  query: string;
  subfolders: string[];
  allFolders: string[];
  files: LibraryFile[];
  canUpload: boolean;
  maxUploadLabel: string;
};

/**
 * The files library: folder navigation, search, multi-file upload with
 * progress (button or drag and drop), and per-file actions. Uploading a
 * name that already exists in the folder offers a new version instead of a
 * duplicate.
 */
export function FilesLibrary({ slug, folder, query, subfolders, allFolders, files, canUpload, maxUploadLabel }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const refresh = useCallback(() => router.refresh(), [router]);
  const uploads = useUploads(slug, refresh);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<LibraryFile | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState<LibraryFile | null>(null);
  const [conflicts, setConflicts] = useState<{ files: File[]; matches: Map<string, LibraryFile> } | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [search, setSearch] = useState(query);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useRealtime(slug, (event) => {
    if (event.type !== "files.changed") return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 500);
  });

  const libraryHref = (path: string) => `/w/${slug}/files${path === "/" ? "" : `?folder=${encodeURIComponent(path)}`}`;

  const queue = (list: File[]) => {
    if (!canUpload || list.length === 0) return;
    const byName = new Map(files.filter((file) => file.folder === folder).map((file) => [file.filename.toLowerCase(), file]));
    const matches = new Map<string, LibraryFile>();
    for (const file of list) {
      const match = byName.get(file.name.toLowerCase());
      if (match) matches.set(file.name, match);
    }
    if (matches.size > 0) setConflicts({ files: list, matches });
    else void uploads.start(list.map((file) => ({ file, fields: { folder } })));
  };

  const resolveConflicts = (asVersions: boolean) => {
    if (!conflicts) return;
    const jobs: UploadJob[] = conflicts.files.map((file) => {
      const match = conflicts.matches.get(file.name);
      return asVersions && match ? { file, fields: { replaceFileId: match.id } } : { file, fields: { folder } };
    });
    setConflicts(null);
    void uploads.start(jobs);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    queue(Array.from(event.dataTransfer.files));
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = files.length > 0 && files.every((file) => selected.has(file.id));
  const selection = files.filter((file) => selected.has(file.id)).map((file) => file.id);
  const empty = files.length === 0 && subfolders.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <FileFolderBreadcrumbs folder={folder} libraryHref={libraryHref} />
        <div className="flex flex-wrap items-center gap-2.5">
          {canUpload ? (
            <>
              <Button variant="secondary" startIcon={null} onClick={() => setNewFolder(true)}>New folder</Button>
              <Button variant="primary" startIcon={null} onClick={() => input.current?.click()} disabled={uploads.busy}>Upload files</Button>
              <input
                ref={input}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => {
                  const list = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  queue(list);
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      <form role="search" action={`/w/${slug}/files`} className="max-w-[560px]">
        <label htmlFor="files-search" className="sr-only">Search files by name</label>
        <SearchInput
          id="files-search"
          name="q"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search files by name"
          onClear={() => {
            setSearch("");
            router.push(libraryHref(folder));
          }}
        />
        {folder !== "/" ? <input type="hidden" name="folder" value={folder} /> : null}
      </form>

      <UploadQueue items={uploads.items} onDismiss={uploads.dismiss} onClear={uploads.clearFinished} />

      <div
        className={cn("relative rounded-xl", dragOver && "outline outline-2 outline-offset-4 outline-[var(--yy-focus)]")}
        onDragOver={(event) => {
          if (!canUpload || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={onDrop}
      >
        {dragOver ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-accent-soft">
            <p className="text-title text-accent-text">Drop to upload to {folder === "/" ? "All files" : folder}</p>
          </div>
        ) : null}

        {empty ? (
          <EmptyState patch
            title={query ? `No files match “${query}”.` : folder === "/" ? "No files yet." : "This folder is empty."}
            action={canUpload && !query ? <Button variant="primary" startIcon={null} onClick={() => input.current?.click()}>Upload files</Button> : undefined}
          >
            {query ? "Try part of the name, or look in another folder." : canUpload ? `Drag files here or upload them. Up to ${maxUploadLabel} each.` : "Files the crew uploads show up here."}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {subfolders.length > 0 ? (
              <ul aria-label="Folders" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {subfolders.map((name) => (
                  <li key={name}>
                    <Link href={libraryHref(joinFolder(folder, name))} className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-panel px-4 text-body-ui font-semibold text-ink transition-colors duration-[120ms] hover:bg-subtle">
                      {null}
                      <span className="truncate">{name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            {selection.length > 0 && canUpload ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-inverse px-4 py-2 text-on-inverse" role="region" aria-label="Selection">
                <span className="text-label">{selection.length} selected</span>
                <Button size="sm" variant="inverse" onClick={() => setMoving(selection)}>Move…</Button>
                <Button size="sm" variant="quiet" className="text-on-inverse hover:text-on-inverse" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            ) : null}

            {files.length > 0 ? (
              <Table label={query ? "Matching files" : "Files"}>
                <THead>
                  <tr>
                    {canUpload ? (
                      <TH className="w-10">
                        <Checkbox aria-label="Select all files" checked={allSelected} onCheckedChange={(checked) => setSelected(checked ? new Set(files.map((file) => file.id)) : new Set())} />
                      </TH>
                    ) : null}
                    <TH className="w-full">Name</TH>
                    <TH className="hidden sm:table-cell">Size</TH>
                    <TH className="hidden md:table-cell">Updated</TH>
                    <TH><span className="sr-only">Actions</span></TH>
                  </tr>
                </THead>
                <TBody>
                  {files.map((file) => (
                    <TR key={file.id}>
                      {canUpload ? (
                        <TD className="w-10">
                          <Checkbox aria-label={`Select ${file.filename}`} checked={selected.has(file.id)} onCheckedChange={() => toggle(file.id)} />
                        </TD>
                      ) : null}
                      <TD className="w-full max-w-0">
                        <Link href={`/w/${slug}/files/${file.id}`} className="block truncate font-semibold text-ink hover:underline">{file.filename}</Link>
                        <span className="flex items-center gap-2 text-caption text-ink-muted">
                          {FILE_KIND_LABEL[fileKind(file.contentType)]}
                          {query && file.folder !== "/" ? <span className="truncate">· {file.folder}</span> : null}
                          {file.version > 1 ? <Chip tone="neutral" size="sm">Version {file.version}</Chip> : null}
                          <span className="tabular-nums sm:hidden">· {formatBytes(file.size)}</span>
                        </span>
                      </TD>
                      <TD className="hidden whitespace-nowrap tabular-nums text-ink-muted sm:table-cell">{formatBytes(file.size)}</TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted md:table-cell">{file.updated} · {file.uploadedBy}</TD>
                      <TD className="w-12 text-right">
                        <LibraryFileMenu
                          slug={slug}
                          file={file}
                          canUpload={canUpload}
                          setRenaming={setRenaming}
                          setMoving={setMoving}
                          setDeleting={setDeleting}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : null}
          </div>
        )}
      </div>

      <RenameFileDialog slug={slug} file={renaming} onClose={() => setRenaming(null)} onDone={refresh} />
      <MoveFilesDialog slug={slug} fileIds={moving} folders={allFolders} currentFolder={folder} onClose={() => setMoving(null)} onDone={() => { setSelected(new Set()); refresh(); }} />
      <DeleteFileDialog slug={slug} file={deleting} onClose={() => setDeleting(null)} onDone={refresh} />

      <UploadConflictDialog
        conflicts={conflicts}
        onClose={() => setConflicts(null)}
        resolveConflicts={resolveConflicts}
      />

      <Dialog open={newFolder} onOpenChange={setNewFolder}>
        <DialogContent size="sm">
          <DialogHeader title="New folder" description={`Inside ${folder === "/" ? "All files" : folder}. It is saved when you upload or move the first file into it.`} />
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              const name = folderName.trim().replace(/[\\/]+/g, "-");
              if (!name) return;
              setNewFolder(false);
              setFolderName("");
              router.push(libraryHref(joinFolder(folder, name)));
            }}
          >
            <DialogBody>
              <Field label="Folder name">
                <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} maxLength={80} placeholder="Line follower bot" autoFocus required />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setNewFolder(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Open folder</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
