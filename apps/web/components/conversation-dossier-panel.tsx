"use client";

import type { ConversationDossier } from "@/lib/conversation-research-dossier";
import { conversationDossierMarkdown } from "@/lib/conversation-research-dossier";
import styles from "./conversation-dossier-panel.module.css";

export function ConversationDossierPanel({ dossier }: { dossier: ConversationDossier }) {
  if (dossier.status === "empty") return null;

  function download(contents: string, mime: string, filename: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section aria-label="Conversation research dossier" className={styles.container}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Verified research evidence</span>
          <h2>Research dossier</h2>
          <p>One conversation, all recorded scientific steps and results.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => download(JSON.stringify(dossier, null, 2), "application/json", "genithm-research-dossier.json")}>Export JSON</button>
          <button type="button" onClick={() => download(conversationDossierMarkdown(dossier), "text/markdown", "genithm-research-dossier.md")}>Export report</button>
        </div>
      </header>
      <p className={styles.summary} role="status">
        {dossier.counts.completed} completed · {dossier.counts.running} running · {dossier.counts.awaiting_approval} need approval
        {dossier.counts.inconclusive ? " · " + dossier.counts.inconclusive + " inconclusive" : ""}
        {dossier.counts.failed ? " · " + dossier.counts.failed + " failed" : ""}
      </p>
      <div className={styles.findings}>
        {dossier.findings.map((finding) => (
          <article className={styles.finding} key={finding.plan_id ?? finding.pipeline_id}>
            <div className={styles.row}>
              <strong>{finding.action}</strong>
              <span className={styles.status}>{finding.state.replaceAll("_", " ")}</span>
            </div>
            {finding.metrics.length ? (
              <dl className={styles.metrics}>
                {finding.metrics.map((metric) => (
                  <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
                ))}
              </dl>
            ) : <p className={styles.note}>No completed scientific measurements are available for this action.</p>}
            {finding.steps.length ? (
              <ol className={styles.steps}>
                {finding.steps.map((step) => (
                  <li key={step.label}>
                    <span>{step.label}</span>
                    <strong>{step.state.replaceAll("_", " ")}</strong>
                    {step.result_sha256 ? <small>SHA-256: <code>{step.result_sha256}</code></small> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {finding.result_sha256 ? (
              <p className={styles.hash}>Recorded SHA-256: <code>{finding.result_sha256}</code></p>
            ) : null}
            {finding.verified_download ? (
              <a className={styles.download} href={finding.verified_download}>
                Download integrity-checked result JSON
              </a>
            ) : null}
          </article>
        ))}
      </div>
      <details className={styles.limitations}>
        <summary>Interpretation and provenance limitations</summary>
        {dossier.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
      </details>
    </section>
  );
}
