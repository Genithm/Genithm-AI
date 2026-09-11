"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import styles from "./scientific-job.module.css";

function statusClass(status: string) {
  if (status === "completed") return `${styles.statusBadge} ${styles.statusCompleted}`;
  if (status === "failed") return `${styles.statusBadge} ${styles.statusFailed}`;
  if (status === "processing" || status === "running") return `${styles.statusBadge} ${styles.statusActive}`;
  return `${styles.statusBadge} ${styles.statusQueued}`;
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function timeLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Waiting";
}

export function ScientificJobStatus({
  status,
  createdAt,
  startedAt,
  finishedAt,
  attempts,
}: {
  status: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  attempts: number;
}) {
  const router = useRouter();
  const terminal = status === "completed" || status === "failed";

  useEffect(() => {
    if (terminal) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refresh, 8000);
    return () => window.clearInterval(interval);
  }, [router, terminal]);

  const createdDone = true;
  const startedDone = Boolean(startedAt);
  const finishedDone = Boolean(finishedAt);

  return (
    <div className={styles.statusPanel} aria-live="polite">
      <div className={styles.statusHeader}>
        <div>
          <span className={statusClass(status)}>{formatStatus(status)}</span>
          <div className={styles.refreshNote} style={{ marginTop: 8 }}>
            Attempt {Math.max(1, attempts || 0)}{terminal ? " · execution finished" : " · status refreshes automatically while this page is open"}
          </div>
        </div>
      </div>

      <div className={styles.timeline} aria-label="Scientific job execution timeline">
        <div className={`${styles.timelineStep} ${createdDone ? styles.timelineDone : ""}`}>
          <strong>01 · Queued</strong>
          <span>{timeLabel(createdAt)}</span>
        </div>
        <div className={`${styles.timelineStep} ${startedDone ? styles.timelineDone : !terminal ? styles.timelineCurrent : ""}`}>
          <strong>02 · Worker execution</strong>
          <span>{startedAt ? timeLabel(startedAt) : terminal ? "No start timestamp recorded" : "Waiting for an isolated scientific worker"}</span>
        </div>
        <div className={`${styles.timelineStep} ${finishedDone ? styles.timelineDone : startedDone && !terminal ? styles.timelineCurrent : ""}`}>
          <strong>03 · Result finalized</strong>
          <span>{finishedAt ? timeLabel(finishedAt) : terminal ? "Finished without a completion timestamp" : "Pending validated result and provenance"}</span>
        </div>
      </div>
    </div>
  );
}
