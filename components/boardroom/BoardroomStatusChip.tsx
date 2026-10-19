import type { BoardroomStatus } from "@prisma/client";
import { Chip } from "@/components/ui/display";

const STATUS: Record<BoardroomStatus, { label: string; tone: "outline" | "info" | "success" | "danger" }> = {
  DRAFT: { label: "Waiting", tone: "outline" },
  RUNNING: { label: "In session", tone: "info" },
  DONE: { label: "Done", tone: "success" },
  FAILED: { label: "Stopped", tone: "danger" },
};

export function BoardroomStatusChip({ status }: { status: BoardroomStatus }) {
  const s = STATUS[status];
  return <Chip size="sm" tone={s.tone}>{s.label}</Chip>;
}
