"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteFileAction, linkFileAction, moveFilesAction, renameFileAction, searchLinkTargetsAction, type LinkTarget } from "@/app/actions/files";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, SearchInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Done = () => void;

export function RenameFileDialog({ slug, file, onClose, onDone }: { slug: string; file: { id: string; filename: string } | null; onClose: () => void; onDone: Done }) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (file && file.id !== lastId) {
    setLastId(file.id);
    setName(file.filename);
    setError(null);
  }
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader title="Rename file" />
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            startTransition(async () => {
              const result = await renameFileAction(slug, { fileId: file.id, filename: name });
              if (!result.ok) {
                setError(result.fieldErrors?.filename?.[0] ?? result.error);
                return;
              }
              showToast("File renamed.", "success");
              onClose();
              onDone();
            });
          }}
        >
          <DialogBody>
            <Field label="Name" error={error ?? undefined} helperText="Keep the extension so it opens in the right app.">
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={180} autoFocus required />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Save name</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveFilesDialog({ slug, fileIds, folders, currentFolder, onClose, onDone }: { slug: string; fileIds: string[] | null; folders: string[]; currentFolder: string; onClose: () => void; onDone: Done }) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [folder, setFolder] = useState(currentFolder);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = fileIds ? fileIds.join(",") : null;
  if (key !== lastKey) {
    setLastKey(key);
    setFolder(currentFolder);
    setError(null);
  }
  const count = fileIds?.length ?? 0;
  return (
    <Dialog open={fileIds !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader title={count === 1 ? "Move file" : `Move ${count} files`} description="Pick a folder or type a new path. New folders are created as you move files into them." />
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!fileIds) return;
            const path = folder.trim().startsWith("/") ? folder.trim() : `/${folder.trim()}`;
            startTransition(async () => {
              const result = await moveFilesAction(slug, { fileIds, folder: path });
              if (!result.ok) {
                setError(result.fieldErrors?.folder?.[0] ?? result.error);
                return;
              }
              showToast(count === 1 ? "File moved." : `${count} files moved.`, "success");
              onClose();
              onDone();
            });
          }}
        >
          <DialogBody>
            <Field label="Folder" error={error ?? undefined} helperText="For example /builds/line-follower. Use / for the top level.">
              <Input value={folder} onChange={(event) => setFolder(event.target.value)} list="file-folders" maxLength={300} autoFocus />
            </Field>
            <datalist id="file-folders">
              {folders.map((path) => <option key={path} value={path} />)}
            </datalist>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Move</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFileDialog({ slug, file, onClose, onDone }: { slug: string; file: { id: string; filename: string } | null; onClose: () => void; onDone: Done }) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <ConfirmDialog
      open={file !== null}
      title={`Delete ${file?.filename ?? "this file"}?`}
      message="It moves to Recently deleted for 30 days, with all its versions. After that it is removed for good."
      confirmLabel="Delete file"
      loading={pending}
      onCancel={onClose}
      onConfirm={() => {
        if (!file) return;
        startTransition(async () => {
          const result = await deleteFileAction(slug, { fileId: file.id });
          if (!result.ok) showToast(result.error, "error");
          else {
            showToast("File deleted. Restore it from Recently deleted.", "success");
            onDone();
          }
          onClose();
        });
      }}
    />
  );
}

/** Link a file to a page and/or a task (search by title or task number). */
export function LinkFileDialog({
  slug,
  file,
  current,
  onClose,
  onDone,
}: {
  slug: string;
  file: { id: string; filename: string } | null;
  current: { doc: { id: string; label: string } | null; task: { id: string; label: string } | null };
  onClose: () => void;
  onDone: Done;
}) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTarget[]>([]);
  const [doc, setDoc] = useState(current.doc);
  const [task, setTask] = useState(current.task);
  const [lastId, setLastId] = useState<string | null>(null);
  if ((file?.id ?? null) !== lastId) {
    setLastId(file?.id ?? null);
    setDoc(current.doc);
    setTask(current.task);
    setQuery("");
  }
  const open = file !== null;

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      const result = await searchLinkTargetsAction(slug, { query });
      setResults(result.ok ? result.data ?? [] : []);
    }, 250);
    return () => clearTimeout(handle);
  }, [open, query, slug]);

  const save = () => {
    if (!file) return;
    startTransition(async () => {
      const result = await linkFileAction(slug, { fileId: file.id, docId: doc?.id ?? null, taskId: task?.id ?? null });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast("Links saved.", "success");
      onClose();
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader title="Link to a page or task" description="The file shows on the page and stays in the library. Linking to an admin-only page makes the file admin-only too." />
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2 text-body-ui">
            <span className="text-ink-muted">Page:</span>
            {doc ? <span className="font-semibold text-ink">{doc.label}</span> : <span className="text-ink-muted">None</span>}
            {doc ? <Button size="sm" variant="dangerQuiet" onClick={() => setDoc(null)}>Remove</Button> : null}
          </div>
          <div className="flex flex-wrap gap-2 text-body-ui">
            <span className="text-ink-muted">Task:</span>
            {task ? <span className="font-semibold text-ink">{task.label}</span> : <span className="text-ink-muted">None</span>}
            {task ? <Button size="sm" variant="dangerQuiet" onClick={() => setTask(null)}>Remove</Button> : null}
          </div>
          <div>
            <label htmlFor="link-search" className="mb-1.5 block text-label text-ink">Find a page or task</label>
            <SearchInput id="link-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, or a task number like 42" onClear={() => setQuery("")} autoFocus />
          </div>
          <ul className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-line">
            {results.length === 0 ? <li className="px-4 py-3 text-caption text-ink-muted">Nothing found.</li> : null}
            {results.map((target) => {
              const chosen = target.type === "doc" ? doc?.id === target.id : task?.id === target.id;
              return (
                <li key={`${target.type}:${target.id}`} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => (target.type === "doc" ? setDoc({ id: target.id, label: target.label }) : setTask({ id: target.id, label: `${target.detail.replace("Task ", "")} ${target.label}` }))}
                    className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left transition-colors duration-[120ms]", chosen ? "bg-accent-soft" : "hover:bg-subtle")}
                  >
                    <span className="truncate text-body-ui text-ink">{target.label}</span>
                    <span className="shrink-0 text-caption text-ink-muted">{target.detail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={pending}>Save links</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
