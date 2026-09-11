"use client";

import Link from "next/link";
import { useEffect } from "react";

import styles from "./dashboard-state.module.css";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Dashboard route error", error);
  }, [error]);

  return (
    <main className={styles.statePage}>
      <section className={styles.errorPanel} role="alert" aria-labelledby="dashboard-error-title">
        <div className={styles.stateKicker}>Workspace recovery</div>
        <h1 id="dashboard-error-title">The research workspace could not be loaded.</h1>
        <p>
          Your data has not been changed. Retry the request, or return to the dashboard entry point and start a fresh navigation.
        </p>
        <div className={styles.actions}>
          <button className="button primary" type="button" onClick={() => reset()}>Retry workspace</button>
          <Link className="button" href="/dashboard">Return to dashboard</Link>
        </div>
        {error.digest ? <div className={styles.reference}>Reference: {error.digest}</div> : null}
      </section>
    </main>
  );
}
