// Generated from app/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, isSuperAdminEmail } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { listUserWorkspaces } from "@/lib/workspaces";

export async function loadHomeRedirect() {
if (await isSetupOpen()) redirect("/setup");
const user = await getCurrentUser();
if (!user) redirect("/login");
const workspaces = await listUserWorkspaces(user.id);
const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
const target = workspaces.find((workspace) => workspace.slug === last) ?? workspaces[0];
if (target) redirect(`/w/${target.slug}`);
const superAdmin = isSuperAdminEmail(user.email);
return viewDto({ user, superAdmin } as const);
}
