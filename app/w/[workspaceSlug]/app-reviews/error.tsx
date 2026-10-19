"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
export default function AppReviewsError({ reset }: { reset: () => void }) {
  return <Card><h2 className="text-h3">Couldn&apos;t load app reviews.</h2><p className="my-3 text-body-ui">Try again in a moment.</p><Button onClick={reset}>Try again</Button></Card>;
}
