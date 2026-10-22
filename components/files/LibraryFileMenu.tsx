"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import type { LibraryFile } from "./FilesLibrary";

export function LibraryFileMenu({ slug, file, canUpload, setRenaming, setMoving, setDeleting }: {
  slug: string;
  file: LibraryFile;
  canUpload: boolean;
  setRenaming: (file: LibraryFile) => void;
  setMoving: (ids: string[]) => void;
  setDeleting: (file: LibraryFile) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={`Actions for ${file.filename}`} size="sm"><Ellipsis /></IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem asChild><Link href={`/w/${slug}/files/${file.id}`}>Open</Link></MenuItem>
        <MenuItem asChild><a href={`/api/files/${file.id}?download=1`}>Download</a></MenuItem>
        {canUpload ? <MenuItem onSelect={() => setRenaming(file)}>Rename…</MenuItem> : null}
        {canUpload ? <MenuItem onSelect={() => setMoving([file.id])}>Move…</MenuItem> : null}
        {file.canDelete ? (
          <>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setDeleting(file)}>Delete…</MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}
