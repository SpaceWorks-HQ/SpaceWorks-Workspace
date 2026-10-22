import { describe } from "vitest";
import "./govextras/fixtures";
import { registerRegistersRisksTests } from "./govextras/registers-risks.cases";
import { registerConflictsTests } from "./govextras/conflicts.cases";
import { registerCaseAccessTests } from "./govextras/case-access.cases";
import { registerCaseLifecycleTests } from "./govextras/case-lifecycle.cases";
import { registerBoardPacksTests } from "./govextras/board-packs.cases";
import { registerRemindersTests } from "./govextras/reminders.cases";
import { registerSearchTests } from "./govextras/search.cases";
import { registerSeedingTests } from "./govextras/seeding.cases";
import { registerAccessRevocationTests } from "./govextras/access-revocation.cases";

describe("governance extras production flows", () => {
  registerRegistersRisksTests();
  registerConflictsTests();
  registerCaseAccessTests();
  registerCaseLifecycleTests();
  registerBoardPacksTests();
  registerRemindersTests();
  registerSearchTests();
  registerSeedingTests();
  registerAccessRevocationTests();
});
