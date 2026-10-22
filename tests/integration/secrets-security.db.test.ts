import { describe } from "vitest";
import "./secrets-security/fixtures";
import { registerValueEncryptionTests } from "./secrets-security/value-encryption.cases";
import { registerEnvironmentAccessTests } from "./secrets-security/environment-access.cases";
import { registerReferenceTests } from "./secrets-security/references.cases";
import { registerProtectedEditTests } from "./secrets-security/protected-edits.cases";
import { registerHistoryRecoveryTests } from "./secrets-security/history-recovery.cases";
import { registerServiceTokenApiTests } from "./secrets-security/service-tokens-api.cases";
import { registerSearchAccessTests } from "./secrets-security/search-access.cases";
import { registerEncryptedShareTests } from "./secrets-security/encrypted-shares.cases";
import { registerRotationReminderTests } from "./secrets-security/rotation-reminders.cases";
import { registerCliDeviceSessionTests } from "./secrets-security/cli-device-sessions.cases";

describe.sequential("application secrets security", () => {
  registerValueEncryptionTests();
  registerEnvironmentAccessTests();
  registerReferenceTests();
  registerProtectedEditTests();
  registerHistoryRecoveryTests();
  registerServiceTokenApiTests();
  registerSearchAccessTests();
  registerEncryptedShareTests();
  registerRotationReminderTests();
});

describe.sequential("CLI device authorisation and sessions", () => {
  registerCliDeviceSessionTests();
});
