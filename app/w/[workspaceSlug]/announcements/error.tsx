"use client";

import { useEffect } from "react";
import { CommunityError } from "@/components/community/PageStates";

export default function CommunityErrorBoundary({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error("[community] announcements failed to load", error);
    else console.error("[community] announcements failed to load");
  }, [error]);
  return <CommunityError what="announcements" reset={() => (retry ?? reset)?.()} />;
}
