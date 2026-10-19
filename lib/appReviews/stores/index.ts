import "server-only";
import type { AppStoreAccount, ReviewedApp } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { appleClient } from "./apple";
import { googleClient } from "./google";
import { StoreError, type StoreClient } from "./types";

/** Never pass the account row or the returned client to a browser or assistant. */
export function storeFor(app: ReviewedApp, account: AppStoreAccount): StoreClient {
  if (app.workspaceId !== account.workspaceId || app.accountId !== account.id || app.platform !== account.platform || !app.active || !account.active) throw new StoreError("AUTH", "This app or store account is paused. Ask an admin to enable it.");
  try {
    const proxyUrl = app.proxyUrlEnc ? decryptSecret("app-review-app-proxy", app.proxyUrlEnc) : account.proxyUrlEnc ? decryptSecret("app-review-account-proxy", account.proxyUrlEnc) : null;
    const transport = { proxyUrl, allowNoProxy: app.allowNoProxy };
    if (app.platform === "APPLE") {
      if (!account.issuerIdEnc || !account.keyIdEnc || !account.privateKeyP8Enc) throw new Error();
      return appleClient({ issuerId: decryptSecret("app-review-issuer", account.issuerIdEnc), keyId: decryptSecret("app-review-key-id", account.keyIdEnc), privateKeyP8: decryptSecret("app-review-private-key", account.privateKeyP8Enc) }, app.appIdentifier, transport);
    }
    if (!account.serviceAccountJsonEnc) throw new Error();
    return googleClient(decryptSecret("app-review-service-account", account.serviceAccountJsonEnc), app.appIdentifier, transport, app.translationLanguage);
  } catch (error) { if (error instanceof StoreError) throw error; throw new StoreError("AUTH", "Couldn't unlock the store account. Ask an admin to check its credentials."); }
}
