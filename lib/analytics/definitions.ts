import "server-only";
import type { Access } from "./access";
import type { Definition } from "./definitions/types";
import { createRegistry } from "./definitions/registry";
import { registerLedger } from "./definitions/ledger";
import { registerCommitments } from "./definitions/commitments";
import { registerFunding } from "./definitions/funding";
import { registerPeople } from "./definitions/people";
import { registerWork } from "./definitions/work";
import { registerOperations } from "./definitions/operations";
import { registerGovernance } from "./definitions/governance";
import { registerMarketing } from "./definitions/marketing";
import { registerCrossArea } from "./definitions/cross-area";

export type { Definition } from "./definitions/types";
export { factSql } from "./definitions/facts";

const registry = createRegistry();
registerLedger(registry);
registerCommitments(registry);
registerFunding(registry);
registerPeople(registry);
registerWork(registry);
registerOperations(registry);
registerGovernance(registry);
registerMarketing(registry);
registerCrossArea(registry);

export const DEFINITIONS: readonly Definition[] = registry.defs;
export function allowedDefinitions(access: Access) {
  return DEFINITIONS.filter((d) => !d.gate || access[d.gate]);
}
