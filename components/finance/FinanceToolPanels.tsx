import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { FinanceAttachments } from "./FinanceAttachments";
import type { AttachedFileMap } from "@/lib/finance/tools/views";
import type { AttachmentType } from "@/lib/finance/tools-rules";

export function EditPanel({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details
      open={open}
      className="rounded-xl border border-line bg-panel p-4 print:hidden"
    >
      <summary className="flex min-h-11 cursor-pointer items-center text-label text-accent-text">
        {title}
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
export function AttachedFiles({
  slug,
  type,
  id,
  files,
  editable,
}: {
  slug: string;
  type: AttachmentType;
  id: string;
  files: AttachedFileMap;
  editable: boolean;
}) {
  const rows = files[id] ?? [];
  return (
    <FinanceAttachments
      key={`${id}:${rows.map((r) => r.attachmentId).join(":")}`}
      slug={slug}
      type={type}
      recordId={id}
      initial={rows}
      editable={editable}
    />
  );
}
export function Empty({
  text,
  add,
  href = "#add-record",
}: {
  text: string;
  add: string;
  href?: string;
}) {
  return (
    <EmptyState
      patch
      title={text}
      action={
        <a href={href} className={buttonClasses({ variant: "secondary" })}>
          {add}
        </a>
      }
    />
  );
}
