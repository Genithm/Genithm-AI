"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh only while research jobs are active; never navigate away from the chat. */
export function ResearchActivityRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}
