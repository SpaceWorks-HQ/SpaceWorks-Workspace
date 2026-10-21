// Generated from app/device/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { inspectDeviceCode } from "@/lib/secrets/device";

export async function loadDevicePage({
  searchParams,
}: PageProps<"/device">) {
const q = await searchParams;
const userCode =
    typeof q.code === "string" ? q.code.trim().toUpperCase() : "";
const user = await getCurrentUser();
if (!user)
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/device?code=${userCode}`)}`,
    );
const device = await inspectDeviceCode(userCode);
const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { mfaEnabledAt: true },
  });
const mfaEnabled = !!account.mfaEnabledAt;
return viewDto({ userCode, device, mfaEnabled } as const);
}
