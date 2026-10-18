import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto flex max-w-[520px] flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span aria-hidden className="relative mb-2 block size-16">
        <span className="absolute inset-0 rounded-[16px] bg-sw-citron" />
        <span className="absolute -bottom-2 -left-2 size-7 rounded-full bg-sw-sky" />
      </span>
      <h1 className="text-h1 text-ink">There&apos;s nothing here.</h1>
      <p className="text-body-ui text-ink-secondary">The page may have moved, or you may not have access to it. Check the link or head back to your workspace.</p>
      <Button asChild variant="primary">
        <Link href="/">Back to your workspace</Link>
      </Button>
    </main>
  );
}
