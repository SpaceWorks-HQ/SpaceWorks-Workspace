import "server-only";

import type { Prisma } from "@prisma/client";

export type ExportRows = Prisma.BusinessDocumentGetPayload<{
  include: {
    allocations: true;
    payments: true;
    files: {
      include: {
        file: { select: { checksum: true; filename: true; size: true } };
      };
    };
  };
}>[];
