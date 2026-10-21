import "server-only";

import type { PersonalChannel } from "@prisma/client";

export type Candidate =
  | { kind: "inline-destination"; target: string; windowSec: number; destinationId: string; ruleId: string | null; userIds: string[] }
  | { kind: "destination"; target: string; windowSec: number; destinationId: string; ruleId: string | null; scheduledFor: Date }
  | { kind: "in-app"; target: string; windowSec: number; userId: string }
  | { kind: "personal"; target: string; windowSec: number; userId: string; channel: PersonalChannel; scheduledFor: Date }
  | { kind: "digest"; target: string; windowSec: number; userId: string; channel: PersonalChannel; frequency: string; dueAt: Date };
