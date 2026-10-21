import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { inspectDeviceCode } from "@/lib/secrets/device";
import { SimpleShell } from "@/components/chrome/SimpleShell";
import { DeviceApproval } from "@/components/secrets/DeviceApproval";
export const metadata: Metadata = {
  title: "Authorise a device",
  referrer: "no-referrer",
};
export default async function DevicePage({
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
  return (
    <SimpleShell>
      <DeviceApproval
        userCode={userCode}
        device={device}
        mfaEnabled={mfaEnabled}
      />
    </SimpleShell>
  );
}
