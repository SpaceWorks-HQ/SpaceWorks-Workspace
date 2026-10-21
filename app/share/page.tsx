import type { Metadata } from "next";
import { SimpleShell } from "@/components/chrome/SimpleShell";
import { ShareViewer } from "@/components/secrets/ShareViewer";
export const metadata: Metadata = {
  title: "Private share",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function SharePage() {
  return (
    <SimpleShell>
      <ShareViewer />
    </SimpleShell>
  );
}
