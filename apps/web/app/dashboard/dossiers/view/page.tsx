import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { loadDossier } from "@/lib/research-dossier.server";
import { reportSourceTitle } from "@/lib/scientific-report";
import styles from "../dossiers.module.css";

export const dynamic = "force-dynamic";

export default async function DossierPreview({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; report_id?: string | string[] }>;
}) {
  const params = await searchParams;
  const reportIds = typeof params.report_id === "string" ? [params.report_id]
    : Array.isArray(params.report_id) ? params.report_id : [];
  const result = await loadDossier(params.project_id ?? "", reportIds);
  if (!result.ok) {
    if (result.status === 401) redirect("/login");
    if (result.status === 404) notFound();
    return (
      <main className={"container dashboard " + styles.screen}>
        <section className={styles.panel}>
          <div className={styles.eyebrow}>Scientific evidence protection</div>
          <h1>Cannot assemble this dossier</h1>
          <p className={styles.hint}>{result.message}</p>
          <Link href="/dashboard/dossiers" className="button">Choose different reports</Link>
        </section>
      </main>
    );
  }
  const { dossier, projectName } = result;
  const exportParams = new URLSearchParams({ project_id: dossier.payload.project_id });
  dossier.payload.reports.forEach(report => exportParams.append("report_id", report.report_id));
  const query = exportParams.toString();
  return (
    <main className={"container dashboard " + styles.screen}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Scientific evidence · Integrity reverified</div>
          <h1>Research dossier</h1>
          <p>{projectName} · {dossier.report_count} sealed scientific reports. Side-by-side recorded measurements and a deterministic package checksum.</p>
        </div>
        <div className="actions">
          <a className="button primary" href={"/dashboard/dossiers/export/json?" + query}>Verified JSON</a>
          <a className="button" href={"/dashboard/dossiers/export/markdown?" + query}>Markdown</a>
          <Link className="button" href="/dashboard/dossiers">Change selection</Link>
        </div>
      </header>
      <section className={styles.panel}>
        <div className={styles.eyebrow}>Evidence provenance</div>
        <h2>Reproducibility identity</h2>
        <div className={styles.summaryGrid}>
          <div><strong>{dossier.report_count}</strong><span>Sealed reports reverified</span></div>
          <div><strong>{new Set(dossier.payload.reports.map(r => r.source_type)).size}</strong><span>Evidence categories</span></div>
          <div><strong>{dossier.comparison.length}</strong><span>Recorded numerical measures</span></div>
        </div>
        <div className={styles.muted}>Canonical dossier payload SHA-256</div>
        <code style={{ color: "var(--accent)", overflowWrap: "anywhere", display: "block", marginTop: 9 }}>{dossier.canonical_payload_sha256}</code>
        <p className={styles.caption}>SHA-256 covers the full canonical dossier payload and snapshots. This is not a digital signature or independent proof of biological correctness. Each report's original seal was checked through the authenticated database report reader.</p>
      </section>
      <section className={styles.panel} style={{ marginTop: 18 }}>
        <div className={styles.eyebrow}>Source-specific numerical evidence</div>
        <h2>Compare measurements</h2>
        {dossier.comparison.length ? (
          <div className={styles.comparisonScroller}>
            <table className={styles.comparison}>
              <thead><tr><th scope="col">Recorded measurement</th>
                {dossier.payload.reports.map((report, i) => (
                  <th scope="col" key={report.report_id}>
                    Report {i + 1}
                    <div className={styles.muted}>{reportSourceTitle(report.source_type, report.source_subtype)}</div>
                  </th>
                ))}</tr></thead>
              <tbody>{dossier.comparison.map(metric => (
                <tr key={metric.key}><th scope="row">{metric.label}{metric.unit ? " (" + metric.unit + ")" : ""}</th>
                  {metric.values.map((value, i) =>
                    <td key={dossier.payload.reports[i].report_id}>{value === null ? "—" : value.toLocaleString()}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={styles.hint}>The selected reports contain no directly supported numeric summary fields from the comparison allowlist.</p>}
        <p className={styles.caption}>Missing values are not zero. Units and methods can differ between analyses. This table does not calculate a new scientific inference, statistical significance, evolutionary relationship or causal conclusion.</p>
      </section>
      <section className={styles.panel} style={{ marginTop: 18 }}>
        <div className={styles.eyebrow}>Immutable evidence</div>
        <h2>Included report seals</h2>
        <div className={styles.sourceCards}>
          {dossier.payload.reports.map((report, index) => (
            <article className={styles.sourceCard} key={report.report_id}>
              <div className={styles.eyebrow}>Report {index + 1} · Verified</div>
              <h3>{reportSourceTitle(report.source_type, report.source_subtype)}</h3>
              <div className={styles.muted}>Generated {new Date(report.generated_at).toLocaleString()}</div>
              <code>Report SHA-256: {report.report_sha256}</code>
              <code>Source evidence: {report.source_evidence_sha256 ?? "Not recorded"}</code>
              <Link href={"/dashboard/reports/" + report.report_id}>Inspect sealed report →</Link>
            </article>
          ))}
        </div>
      </section>
      <div className={styles.policy}>
        <strong>Evidence boundary:</strong> This dossier is a curated research package, not a new scientific computation. It contains existing authoritative snapshots, immutable references and measured output fields. Live upstream database freshness, external literature support and AI interpretation should be evaluated separately.
      </div>
    </main>
  );
}
