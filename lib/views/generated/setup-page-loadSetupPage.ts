// Generated from app/setup/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { redirect } from "next/navigation";
import { isSetupOpen } from "@/lib/setup";

export async function loadSetupPage() {
if (!(await isSetupOpen())) redirect("/login");
return viewDto({  } as const);
}
