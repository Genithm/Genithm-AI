"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function WorkflowAutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!enabled || !auto) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20000);
    return () => window.clearInterval(interval);
  }, [auto, enabled, router]);
  return (
    <label style={{ display: "inline-flex", gap: 9, alignItems: "center", fontSize: 12 }}>
      <input type="checkbox" checked={auto} disabled={!enabled}
        onChange={event => setAuto(event.target.checked)} />
      {enabled ? "Refresh active workflow every 20 seconds" : "Automatic refresh paused — review required or workflow finished"}
    </label>
  );
}
