"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { LibraryFile } from "./FilesLibrary";

export function UploadConflictDialog({ conflicts, onClose, resolveConflicts }: {
  conflicts: { files: File[]; matches: Map<string, LibraryFile> } | null;
  onClose: () => void;
  resolveConflicts: (asVersions: boolean) => void;
}) {
  return (
    <Dialog open={conflicts !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          title={conflicts?.matches.size === 1 ? `${[...conflicts.matches.keys()][0]} is already here` : `${conflicts?.matches.size ?? 0} files are already here`}
          description={conflicts?.matches.size === 1 ? "Add it as a new version to keep one file with its history, or keep both copies side by side." : "Add them as new versions to keep one file each with its history, or keep both copies side by side."}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => resolveConflicts(false)}>Keep both</Button>
          <Button variant="primary" onClick={() => resolveConflicts(true)}>{conflicts?.matches.size === 1 ? "Add as a new version" : "Add as new versions"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
