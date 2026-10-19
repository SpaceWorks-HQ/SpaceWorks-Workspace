"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Ellipsis, Upload } from "lucide-react";
import { restoreFileVersionAction } from "@/app/actions/files";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Chip, SectionHeading } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatBytes } from "@/lib/files/versions";
import { DeleteFileDialog, LinkFileDialog, MoveFilesDialog, RenameFileDialog } from "./FileDialogs";
import { UploadQueue } from "./UploadQueue";
import { useUploads } from "./useUploads";

export type FileVersionRow = { version: number; size: number; uploadedBy: string; when: string; note: string | null };

/** Actions on one file (download, new version, rename, move, link, delete) plus its version list. */
export function FileDetailActions({
  slug,
  file,
  canEdit,
  canDelete,
  folders,
  links,
}: {
  slug: string;
  file: { id: string; filename: string; folder: string };
  canEdit: boolean;
  canDelete: boolean;
  folders: string[];
  links: { doc: { id: string; label: string } | null; task: { id: string; label: string } | null };
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const uploads = useUploads(slug, refresh);
  const input = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState<"rename" | "move" | "link" | "delete" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2.5">
        <Button asChild variant="primary" startIcon={<Download />}>
          <a href={`/api/files/${file.id}?download=1`}>Download</a>
        </Button>
        {canEdit ? (
          <>
            <Button variant="secondary" startIcon={<Upload />} disabled={uploads.busy} onClick={() => input.current?.click()}>Upload new version</Button>
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                event.target.value = "";
                setPickedFile(picked);
              }}
            />
          </>
        ) : null}
        {canEdit || canDelete ? (
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="More file actions" variant="secondary"><Ellipsis /></IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              {canEdit ? <MenuItem onSelect={() => setDialog("rename")}>Rename…</MenuItem> : null}
              {canEdit ? <MenuItem onSelect={() => setDialog("move")}>Move…</MenuItem> : null}
              {canEdit ? <MenuItem onSelect={() => setDialog("link")}>Link to a page or task…</MenuItem> : null}
              {canDelete ? (
                <>
                  {canEdit ? <MenuSeparator /> : null}
                  <MenuItem danger onSelect={() => setDialog("delete")}>Delete…</MenuItem>
                </>
              ) : null}
            </MenuContent>
          </Menu>
        ) : null}
      </div>
      <UploadQueue items={uploads.items} onDismiss={uploads.dismiss} onClear={uploads.clearFinished} />

      <Dialog open={pickedFile !== null} onOpenChange={(open) => !open && setPickedFile(null)}>
        <DialogContent size="sm">
          <DialogHeader title="Upload a new version" description={`${pickedFile?.name ?? ""} becomes the current version of ${file.filename}. Older versions stay downloadable.`} />
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (!pickedFile) return;
              void uploads.start([{ file: pickedFile, fields: { replaceFileId: file.id, note: note.trim() || undefined } }]);
              setPickedFile(null);
              setNote("");
            }}
          >
            <DialogBody>
              <Field label="What changed" optional helperText="A short note shown in the version list.">
                <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="Tuned speeds for 3 mm plywood" autoFocus />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPickedFile(null)}>Cancel</Button>
              <Button type="submit" variant="primary">Upload version</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RenameFileDialog slug={slug} file={dialog === "rename" ? file : null} onClose={() => setDialog(null)} onDone={refresh} />
      <MoveFilesDialog slug={slug} fileIds={dialog === "move" ? [file.id] : null} folders={folders} currentFolder={file.folder} onClose={() => setDialog(null)} onDone={refresh} />
      <LinkFileDialog slug={slug} file={dialog === "link" ? file : null} current={links} onClose={() => setDialog(null)} onDone={refresh} />
      <DeleteFileDialog slug={slug} file={dialog === "delete" ? file : null} onClose={() => setDialog(null)} onDone={() => router.push(`/w/${slug}/files`)} />
    </div>
  );
}

export function FileVersions({ slug, fileId, currentVersion, versions, canEdit }: { slug: string; fileId: string; currentVersion: number; versions: FileVersionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [restoring, setRestoring] = useState<FileVersionRow | null>(null);
  return (
    <section aria-labelledby="versions-heading" className="flex flex-col gap-3">
      <SectionHeading as="h2" title={<span id="versions-heading">Versions</span>} description="Restoring copies an old version into a new one, so the history stays complete." />
      <Table label="Versions">
        <THead>
          <tr>
            <TH>Version</TH>
            <TH className="hidden sm:table-cell">Uploaded</TH>
            <TH className="hidden sm:table-cell">Size</TH>
            <TH><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {versions.map((version) => (
            <TR key={version.version}>
              <TD>
                <span className="flex items-center gap-2 font-semibold tabular-nums text-ink">
                  Version {version.version}
                  {version.version === currentVersion ? <Chip tone="success" size="sm">Current</Chip> : null}
                </span>
                {version.note ? <span className="block text-caption text-ink-secondary">{version.note}</span> : null}
                <span className="block text-caption text-ink-muted sm:hidden">{version.when} · {version.uploadedBy} · {formatBytes(version.size)}</span>
              </TD>
              <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{version.when} · {version.uploadedBy}</TD>
              <TD className="hidden whitespace-nowrap tabular-nums text-ink-muted sm:table-cell">{formatBytes(version.size)}</TD>
              <TD className="whitespace-nowrap text-right">
                <span className="inline-flex flex-wrap justify-end gap-1">
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/w/${slug}/files/${fileId}/versions/${version.version}`} aria-label={`Download version ${version.version}`}>Download</a>
                  </Button>
                  {canEdit && version.version !== currentVersion ? (
                    <Button size="sm" variant="ghost" onClick={() => setRestoring(version)} aria-label={`Restore version ${version.version}`}>Restore…</Button>
                  ) : null}
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <ConfirmDialog
        open={restoring !== null}
        destructive={false}
        title={`Restore version ${restoring?.version ?? ""}?`}
        message="It becomes a new current version. The version you have now stays in the list."
        confirmLabel="Restore version"
        loading={pending}
        onCancel={() => setRestoring(null)}
        onConfirm={() => {
          const target = restoring;
          if (!target) return;
          startTransition(async () => {
            const result = await restoreFileVersionAction(slug, { fileId, version: target.version });
            setRestoring(null);
            if (!result.ok) showToast(result.error, "error");
            else {
              showToast(`Version ${target.version} restored as version ${result.data?.version ?? ""}.`, "success");
              router.refresh();
            }
          });
        }}
      />
    </section>
  );
}
