import { describe } from "vitest";
import "./platform-shell-security/fixtures";
import { registerSearchPermissionsTests } from "./platform-shell-security/search-permissions.cases";
import { registerNotificationsTests } from "./platform-shell-security/notifications.cases";
import { registerExportRedactionTests } from "./platform-shell-security/export-redaction.cases";
import { registerRetentionTests } from "./platform-shell-security/retention.cases";
import { registerOidcTests } from "./platform-shell-security/oidc.cases";

describe("platform search tenant and permission isolation", () => {
  registerSearchPermissionsTests();
});

describe("notification centre", () => {
  registerNotificationsTests();
});

describe("export redaction", () => {
  registerExportRedactionTests();
});

describe("retention legal hold", () => {
  registerRetentionTests();
});

describe("OIDC no automatic account creation", () => {
  registerOidcTests();
});
