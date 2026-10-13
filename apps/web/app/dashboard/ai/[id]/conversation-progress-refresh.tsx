"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Lightweight polling for this conversation only. Backend RLS still gates
 * every result query; no client polling of privileged service endpoints.
 */
export function ConversationProgressRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 9000);
    return () => window.clearInterval(interval);
  }, [active, router]);
  return null;
}
