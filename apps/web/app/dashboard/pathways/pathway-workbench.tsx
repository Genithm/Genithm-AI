"use client";

import Link from "next/link";
import {useEffect, useRef, useState} from "react";
import {MAX_PATHWAY_GMT_BYTES, MAX_PATHWAY_LIST_BYTES, PATHWAY_VERSION, pathwaysTsv,
  type PathwayResult} from "@/lib/pathway-enrichment";
import styles from "../expression/research-labs.module.css";

type Evidence = {result: PathwayResult; selectedSha256: string; universeSha256: string; gmtSha256: string};
type WorkerReply = {kind: "progress"; count: number} | ({kind: "complete"} & Evidence) | {kind: "error"; message: string};
function downloadText(content: string, filename: string, mime = "text/tab-separated-values") {
  const url = URL.createObjectURL(new Blob([content], {type: `${mime};charset=utf-8`}));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pText(p: number) {return p < .0001 ? p.toExponential(3) : p.toFixed(5);}
function makeSynthetic(kind: "selected" | "universe" | "gmt") {
  const genes = Array.from({length: 100}, (_, i) => `G${i + 1}`);
  if (kind === "selected") downloadText("gene_id\n"+genes.slice(0, 5).join("\n")+"\n","genithm-SYNTHETIC-selected-genes.tsv");
  if (kind === "universe") downloadText("gene_id\n"+genes.join("\n")+"\n","genithm-SYNTHETIC-background.tsv");
  if (kind === "gmt") downloadText("SYNTHETIC_HIT\tArtificial example\tG1\tG2\tG3\tG6\tG7\tG8\tG9\tG10\n"+
    "SYNTHETIC_NULL\tArtificial example\tG20\tG21\tG22\tG23\tG24\n"+
    "SYNTHETIC_MIXED\tArtificial example\tG4\tG16\tG17\tG18\n", "genithm-SYNTHETIC-pathways.gmt");
}
export function PathwayWorkbench() {
  const [selected, setSelected] = useState<File | null>(null);
  const [universe, setUniverse] = useState<File | null>(null);
  const [gmt, setGmt] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => {worker.current?.terminate(); worker.current = null;}, []);
  function cancel() {worker.current?.terminate(); worker.current = null; setRunning(false); setStatus("Cancelled; no results were saved.");}
  function run() {
    if (running || !selected || !universe || !gmt) return;
    if (selected.size < 1 || selected.size > MAX_PATHWAY_LIST_BYTES ||
        universe.size < 1 || universe.size > MAX_PATHWAY_LIST_BYTES ||
        gmt.size < 1 || gmt.size > MAX_PATHWAY_GMT_BYTES) {
      setError("Selected and measured gene lists must be ≤1 MiB each; GMT ≤8 MiB."); return;
    }
    setError(""); setEvidence(null); setRunning(true);
    setStatus("Reading all three files and matching gene namespaces locally...");
    const job = new Worker(new URL("./pathways.worker.ts", import.meta.url));
    worker.current = job;
    job.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (worker.current !== job) return;
      const message = event.data;
      if (message.kind === "progress") setStatus(`${message.count.toLocaleString()} gene sets evaluated...`);
      if (message.kind === "complete") {
        setEvidence({result: message.result, selectedSha256: message.selectedSha256,
          universeSha256: message.universeSha256, gmtSha256: message.gmtSha256});
        setStatus("All eligible pathways tested with exact hypergeometric statistics and FDR.");
        setRunning(false); job.terminate(); worker.current = null;
      }
      if (message.kind === "error") {
        setError(message.message); setStatus(""); setRunning(false); job.terminate(); worker.current = null;
      }
    };
    job.onerror = () => {setError("Local enrichment worker failed; no partial report was accepted."); setRunning(false); job.terminate(); worker.current = null;};
    job.postMessage({selected, universe, gmt});
  }
  const result = evidence?.result;
  const hits = result?.pathways.filter(x => x.fdr < .05 && x.overlap > 0) ?? [];
  const chart = result?.pathways.filter(x => x.overlap > 0).slice(0, 16) ?? [];
  const peak = Math.max(1, ...chart.map(x => Math.min(50, -Math.log10(x.fdr))));
  return <div className={styles.workbench}>
    <section className={styles.panel} aria-label="Pathway enrichment inputs">
      <div><span className={styles.eyebrow}>STEP 1 / YOUR GENES + ANNOTATIONS</span><h2>Test gene-set over-representation</h2>
        <p className={styles.intro}>Supply <strong>selected genes</strong> (e.g. expression hits), the set of <strong>all measured and tested genes</strong> that could have been selected, and a GMT file with each line formatted as <code>set_name TAB description TAB gene1 TAB gene2…</code>. Identifiers must match exactly, including case.</p></div>
      <div className={styles.inputsTriple}>
        <label>Selected gene IDs (.txt/.tsv)
          <input type="file" accept=".tsv,.txt" disabled={running} onChange={e => {setSelected(e.currentTarget.files?.[0] ?? null); setEvidence(null);}} /></label>
        <label>Measured background genes (.txt/.tsv)
          <input type="file" accept=".tsv,.txt" disabled={running} onChange={e => {setUniverse(e.currentTarget.files?.[0] ?? null); setEvidence(null);}} /></label>
        <label>Gene sets (.gmt)
          <input type="file" accept=".gmt,.txt" disabled={running} onChange={e => {setGmt(e.currentTarget.files?.[0] ?? null); setEvidence(null);}} /></label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={running || !selected || !universe || !gmt} onClick={run}>Run pathway enrichment</button>
        {running && <button type="button" className={styles.secondary} onClick={cancel}>Cancel</button>}
        <button type="button" className={styles.secondary} disabled={running} onClick={() => makeSynthetic("selected")}>Synthetic selected genes</button>
        <button type="button" className={styles.secondary} disabled={running} onClick={() => makeSynthetic("universe")}>Synthetic background</button>
        <button type="button" className={styles.secondary} disabled={running} onClick={() => makeSynthetic("gmt")}>Synthetic GMT</button>
      </div>
      <p className={styles.notes}>The measured universe is required. An unrelated whole-genome background can generate biased enrichment. Up to 50,000 measured genes, 5,000 selected genes and 10,000 sets are supported. Local files remain on this device; no external pathway lookup or cloud storage is performed.</p>
      {status && <p className={styles.status} role="status">{status}</p>}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </section>
    {result && evidence && <section className={styles.panel} aria-label="Computed pathway enrichment results">
      <span className={styles.eyebrow}>STEP 2 / COMPUTED ON YOUR DEVICE</span><h2>Over-representation results</h2>
      <div className={styles.metrics}>
        <article><small>Selected genes</small><strong>{result.inputSelectedGenes.toLocaleString()}</strong></article>
        <article><small>Measured background</small><strong>{result.universeGenes.toLocaleString()}</strong></article>
        <article><small>Tested gene sets</small><strong>{result.eligibleSetsTested.toLocaleString()}</strong></article>
        <article><small>Significant BH q below .05</small><strong>{hits.length.toLocaleString()}</strong></article>
      </div>
      <figure className={styles.chart}><figcaption>Top pathways: BH-adjusted significance from actual overlaps</figcaption>
        <svg viewBox="0 0 920 420" role="img" aria-label="Horizontal bars of minus log10 FDR for top pathways with nonzero gene overlap">
          {chart.map((set, i) => <g key={set.name}>
            <text x="12" y={26 + i * 24} fontSize="11" fill="#51627a">{set.name.slice(0, 31)}</text>
            <rect x="255" y={15 + i * 24} width={Math.max(0, Math.min(50, -Math.log10(set.fdr)) / peak * 540)} height="12"
              rx="3" fill={set.fdr < .05 ? "#bc526c" : "#398ab9"}>
              <title>{`${set.name}: ${set.overlap}/${set.setSize} genes; p=${pText(set.p)}; BH q=${pText(set.fdr)}`}</title>
            </rect>
            <text x="804" y={26 + i * 24} fontSize="10" fill="#586982">{pText(set.fdr)}</text>
          </g>)}
          <text x="255" y="414" fontSize="11" fill="#51627a">−log10(BH adjusted P); adjusted P also printed at right</text>
        </svg>
        <p>{chart.length ? "The chart displays the top pathways with at least one selected gene. The FDR correction includes all eligible pathways, even those with zero overlap." : "No selected gene overlaps the eligible pathways; zero hits are displayed in the full report."}</p>
      </figure>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => downloadText(pathwaysTsv(result),"genithm-pathways-all-tested-sets.tsv")}>Download pathway statistics</button>
        <Link href="/dashboard/expression" className={styles.secondary}>Return to RNA Expression Lab</Link>
        <button type="button" className={styles.secondary} onClick={() => downloadText(JSON.stringify({schema:result.schema,version:result.version,method:result.method,
          selected_sha256:evidence.selectedSha256,background_sha256:evidence.universeSha256,gmt_sha256:evidence.gmtSha256,
          selected_genes:result.inputSelectedGenes,background_genes:result.universeGenes,sets_seen:result.pathwaySetsSeen,
          sets_tested:result.eligibleSetsTested,excluded:result.excludedSets,warnings:result.warnings},null,2),"genithm-pathways-provenance.json","application/json")}>Download provenance JSON</button>
      </div>
      <div className={styles.tableWrap}><table><caption className="genithm-sr-only">Top 30 eligible pathways sorted by hypergeometric P</caption>
        <thead><tr><th>Pathway</th><th>Gene overlap</th><th>Expected overlap</th><th>Enrichment</th><th>Exact P</th><th>BH q</th></tr></thead>
        <tbody>{result.pathways.slice(0, 30).map(p => <tr key={p.name}><td>{p.name}</td><td>{p.overlap} / {p.setSize}</td>
          <td>{p.expectedOverlap.toFixed(3)}</td><td>{p.enrichmentRatio.toFixed(2)}×</td>
          <td>{pText(p.p)}</td><td>{pText(p.fdr)}</td></tr>)}</tbody></table></div>
      <details className={styles.provenance}><summary>Method, input checksums and scientific limitations</summary>
        <p>Engine {PATHWAY_VERSION}. {result.method}. Gene sets seen: {result.pathwaySetsSeen}; excluded for size: {result.excludedSets.too_small + result.excludedSets.too_large}; not present in universe: {result.excludedSets.not_in_universe}.</p>
        <p>Selected genes SHA-256: <code>{evidence.selectedSha256}</code></p>
        <p>Measured universe SHA-256: <code>{evidence.universeSha256}</code></p>
        <p>GMT source SHA-256: <code>{evidence.gmtSha256}</code></p>
        {result.warnings.map(w => <p className={styles.warning} key={w}>{w}</p>)}
      </details>
    </section>}
  </div>;
}
