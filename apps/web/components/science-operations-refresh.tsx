"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Read-only monitoring. This never starts a worker, mutation, or approval. */
export function ScienceOperationsRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}
