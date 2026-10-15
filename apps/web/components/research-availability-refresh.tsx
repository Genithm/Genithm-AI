"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * V28: a small, visibility-aware refresh while a configured science system
 * is offline. Never posts a request, triggers an approval, or invokes a job.
 * Recovery only makes the researcher eligible to submit a NEW consent.
 */
export function ResearchAvailabilityRefresh({ watching }: { watching: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!watching) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [watching, router]);
  return null;
}
