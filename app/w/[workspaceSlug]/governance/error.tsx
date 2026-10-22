"use client";
import { Button } from "@/components/ui/button";
export default function Error({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="space-y-4 p-6">
      <h2 className="text-h2">Couldn’t load governance records.</h2>
      <p>Try loading this page again.</p>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}
