// Generated from app/login/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { auth, type SsoMfaChallenge } from "@/lib/auth";
import { publicOidcProviders } from "@/lib/shell/oidc";
import { redirect } from "next/navigation";
import { getGoogleSsoSettings } from "@/lib/instanceSettings";
import { getCurrentUser } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";

export async function loadLoginPage() {
if (await isSetupOpen()) redirect("/setup");
if (await getCurrentUser()) redirect("/");
const googleEnabled = Boolean(await getGoogleSsoSettings().catch(() => null));
const oidcProviders = await publicOidcProviders().catch(() => []);
const session = await auth();
const ssoMfa = Boolean((session as typeof session & { ssoMfa?: SsoMfaChallenge })?.ssoMfa);
return viewDto({ googleEnabled, oidcProviders, ssoMfa } as const);
}
