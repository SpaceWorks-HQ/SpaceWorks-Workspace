import Link from "next/link";
import { Patch } from "@/components/brand/Patch";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex max-w-[520px] flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Patch pose="walk" size={160} className="mb-2" />
      <h1 className="text-h1 text-ink">There&apos;s nothing here.</h1>
      <p className="text-body-ui text-ink-secondary">The page may have moved, or you may not have access to it. Check the link or head back to your workspace.</p>
      <Button asChild variant="primary">
        <Link href="/">Back to your workspace</Link>
      </Button>
    </main>
  );
}
