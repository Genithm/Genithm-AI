"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { ExplorerResult } from "@/lib/scientific-result-explorer";
import {
  buildVerifiedComparison, formatComparisonNumber, verifiedComparisonTsv,
  type ComparableJobType, type VerifiedComparison, type VerifiedComparisonRun,
} from "@/lib/verified-scientific-comparison";
import styles from "@/app/dashboard/results/compare/compare.module.css";

export type ComparisonJob = {
  id: string;
  jobType: ComparableJobType;
  sha256: string;
  toolVersion: string;
};

type VerifiedResponse = {
  verification: string;
  sha256: string;
  jobType: string;
  view: ExplorerResult;
};

type LoadState = "loading" | "verified" | "error";

function downloadText(name: string, value: string) {
  const blob = new Blob([value], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function VerifiedComparisonViewer({ jobs }: { jobs: ComparisonJob[] }) {
  const [status, setStatus] = useState<LoadState>("loading");
  const [comparison, setComparison] = useState<VerifiedComparison | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [metricKey, setMetricKey] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError("");
    setComparison(null);

    async function load() {
      try {
        const verified: VerifiedComparisonRun[] = await Promise.all(jobs.map(async job => {
          const uri = "/dashboard/scientific-jobs/" + encodeURIComponent(job.id) + "/explore";
          const response = await fetch(uri, {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(response.status === 409
              ? "One scientific artifact failed integrity or format validation."
              : response.status === 401 ? "Your session has expired. Sign in again."
              : "One of the selected scientific artifacts cannot be accessed.");
          }
          const data = await response.json() as VerifiedResponse;
          if (data.verification !== "sha256-verified" ||
              data.sha256 !== job.sha256 || data.jobType !== job.jobType ||
              !data.view ||
              (job.jobType === "protein_properties" && data.view.kind !== "protein") ||
              (job.jobType === "pairwise_alignment" && data.view.kind !== "pairwise")) {
            throw new Error("Scientific result verification or type does not match the selected job.");
          }
          return {
            id: job.id, jobType: job.jobType, sha256: data.sha256,
            toolVersion: job.toolVersion, view: data.view as VerifiedComparisonRun["view"],
          };
        }));
        const built = buildVerifiedComparison(verified);
        if (!controller.signal.aborted) {
          setComparison(built);
          setMetricKey(built.kind === "protein_properties" ? "length" : "match_fraction");
          setStatus("verified");
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Verification failed.");
        setStatus("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [jobs, retry]);

  const selectedMetric = useMemo(() =>
    comparison?.metrics.find(metric => metric.key === metricKey) ??
    comparison?.metrics[0] ?? null,
    [comparison, metricKey]);

  const extent = useMemo(() => {
    const values = selectedMetric?.values ?? [];
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    return { min, max };
  }, [selectedMetric]);

  function downloadVerifiedTable() {
    if (!comparison || status !== "verified") return;
    const content = verifiedComparisonTsv(comparison);
    downloadText("genithm-verified-comparison-" + comparison.runs[0].id.slice(0, 8) + ".tsv", content);
  }

  if (status === "loading") return (
    <section className={styles.panel} aria-live="polite">
      <h2>Verifying scientific artifacts</h2>
      <p role="status">Authenticating access and checking SHA-256, byte lengths and scientific formats for all {jobs.length} results. No comparison is shown before all checks pass.</p>
    </section>
  );

  if (status === "error" || !comparison) return (
    <section className={styles.panel} aria-live="polite">
      <h2>Comparison unavailable</h2>
      <p role="alert" className={styles.error}>{error || "The selected scientific evidence could not be verified."}</p>
      <p>Results are intentionally withheld when any selected artifact is missing, inaccessible, altered or malformed.</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => setRetry(n => n + 1)}>Retry verification</button>
        <Link href="/dashboard/results">Choose other results</Link>
      </div>
    </section>
  );

  return (
    <section className={styles.panel} aria-label="SHA-256 verified scientific comparison">
      <div className={styles.panelHeader}>
        <div>
          <span className={styles.verified}>✓ All {comparison.runs.length} artifacts SHA-256 verified</span>
          <h2>{comparison.kind === "protein_properties" ? "Protein property comparison" : "Pairwise alignment comparison"}</h2>
          <p>Measured columns are extracted from the authenticated, integrity-checked scientific result explorer.</p>
        </div>
        <button type="button" onClick={downloadVerifiedTable} className={styles.export}>
          ↓ Export verified TSV
        </button>
      </div>

      <div className={styles.runGrid} aria-label="Compared scientific runs">
        {comparison.runs.map((run, index) => (
          <article className={styles.runCard} key={run.id}>
            <span className={styles.runNumber}>Run {index + 1}</span>
            <strong>{run.jobType.replaceAll("_", " ")}</strong>
            <p>Tool version: {run.toolVersion}</p>
            <div className={styles.runHash} title={run.sha256}>SHA-256: <code>{run.sha256.slice(0, 16)}…</code></div>
            <Link href={"/dashboard/scientific-jobs/" + run.id}>Open original analysis ↗</Link>
          </article>
        ))}
      </div>

      <div className={styles.chartHeader}>
        <div>
          <h3>Compare recorded measurements</h3>
          <p>Choose one measure to display across the verified runs.</p>
        </div>
        <label htmlFor="comparison-metric">
          Measurement
          <select id="comparison-metric" value={selectedMetric?.key ?? ""}
            onChange={event => setMetricKey(event.target.value)}>
            {comparison.metrics.map(metric => (
              <option key={metric.key} value={metric.key}>{metric.label} ({metric.unit})</option>
            ))}
          </select>
        </label>
      </div>

      {selectedMetric ? (
        <div className={styles.chart} aria-label={"Comparative plot for " + selectedMetric.label}>
          <div className={styles.axisLabels}>
            <span>{formatComparisonNumber(extent.min)} {selectedMetric.unit}</span>
            <span>{formatComparisonNumber(extent.max)} {selectedMetric.unit}</span>
          </div>
          {comparison.runs.map((run, index) => {
            const value = selectedMetric.values[index];
            const position = extent.max === extent.min
              ? 50 : 5 + 90 * (value - extent.min) / (extent.max - extent.min);
            return (
              <div className={styles.chartRow} key={run.id}>
                <span>Run {index + 1}</span>
                <div className={styles.chartTrack}>
                  <span className={styles.marker} style={{ left: position + "%" }}
                    title={selectedMetric.label + ": " + formatComparisonNumber(value) + " " + selectedMetric.unit} />
                </div>
                <strong>{formatComparisonNumber(value)}</strong>
              </div>
            );
          })}
          <p>Dot positions use the minimum and maximum of the selected measurements as the displayed scale. This is a descriptive comparison only.</p>
        </div>
      ) : null}

      <h3 className={styles.tableHeading}>Comparison data</h3>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Measured quantity</th>
              <th scope="col">Unit</th>
              {comparison.runs.map((run, index) => <th key={run.id} scope="col">Run {index + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map(metric => (
              <tr key={metric.key}>
                <th scope="row">{metric.label}</th>
                <td>{metric.unit}</td>
                {metric.values.map((value, index) =>
                  <td key={comparison.runs[index].id}>{formatComparisonNumber(value)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.boundary}>{comparison.description}</p>
      {new Set(comparison.runs.map(run => run.toolVersion)).size > 1 ? (
        <p className={styles.warning} role="note">
          The compared results use different tool versions. Numerical differences may reflect method or version changes.
        </p>
      ) : null}
      <p className={styles.footerNote}>
        The TSV includes every compared job ID, its recorded SHA-256, algorithm version and all displayed measurements.
        This verification applies to the artifacts retrieved for this session; it does not establish experimental or clinical validity.
      </p>
    </section>
  );
}
