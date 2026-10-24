"use client";

import Link from "next/link";
import {useEffect, useRef, useState} from "react";
import {EXPRESSION_VERSION, MAX_COUNT_BYTES, MAX_DESIGN_BYTES, expressionTsv,
  expressionGeneList, type ExpressionResult, type ExpressionGene} from "@/lib/expression-analysis";
import styles from "./research-labs.module.css";

type Evidence = {result: ExpressionResult; countsSha256: string; designSha256: string};
type WorkerReply = {kind: "progress"; count: number} | ({kind: "complete"} & Evidence) | {kind: "error"; message: string};
function downloadText(content: string, filename: string, mime = "text/tab-separated-values") {
  const blob = new Blob([content], {type: `${mime};charset=utf-8`});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function labelP(p: number): string {return p < .0001 ? p.toExponential(3) : p.toFixed(5);}
function makeSynthetic(kind: "counts" | "design") {
  const ids = Array.from({length: 8}, (_, i) => `S${i + 1}`);
  if (kind === "design") {
    downloadText("sample_id\tcondition\n" + ids.map((id, i) => `${id}\t${i < 4 ? "control" : "treated"}`).join("\n") + "\n",
      "genithm-SYNTHETIC-expression-design.tsv");
    return;
  }
  const rows = ["gene_id\t" + ids.join("\t")];
  for (let gene = 0; gene < 80; gene++) {
    const vals = ids.map((_, i) => Math.max(1, Math.round((100 + (gene % 11) * 12 + ((gene * 7 + i * 13) % 17 - 8) +
      (gene === 0 && i >= 4 ? 450 : 0)) * (i % 2 === 0 ? 1.3 : .9))));
    rows.push(`GENE${String(gene + 1).padStart(4, "0")}\t${vals.join("\t")}`);
  }
  downloadText(rows.join("\n") + "\n", "genithm-SYNTHETIC-expression-counts.tsv");
}
function ExpressionPlots({result}: {result: ExpressionResult}) {
  const significant = (g: ExpressionGene) => g.fdr < .05 && Math.abs(g.log2FoldChange) >= 1;
  const sorted = result.genes.slice().sort((a, b) => a.p - b.p);
  const strong = new Set(sorted.slice(0, 75));
  const points = result.genes.length <= 2400 ? result.genes : result.genes.filter((g, i) =>
    i % Math.ceil(result.genes.length / 2200) === 0 || strong.has(g));
  const scaleX = Math.max(2, Math.min(8, Math.ceil(Math.max(...result.genes.map(g => Math.abs(g.log2FoldChange))))));
  const scaleY = Math.max(3, Math.min(30, Math.ceil(Math.max(...result.genes.map(g => -Math.log10(g.fdr))))));
  const wx = (fc: number) => 44 + (Math.max(-scaleX, Math.min(scaleX, fc)) + scaleX) / (2 * scaleX) * 525;
  const wy = (p: number) => 258 - Math.min(scaleY, -Math.log10(Math.max(p, 1e-300))) / scaleY * 232;
  const samples = result.samples;
  const maxAxis = Math.max(1, ...samples.map(s => Math.abs(s.pc1)), ...samples.map(s => Math.abs(s.pc2)));
  const coord = (v: number, invert = false) => invert ? 260 - (v / maxAxis + 1) * 116 : 40 + (v / maxAxis + 1) * 260;
  return <div className={styles.charts}>
    <figure className={styles.chart}>
      <figcaption>Volcano: observed log2 change vs BH-adjusted P</figcaption>
      <svg viewBox="0 0 590 310" role="img" aria-label="Computed gene-wise log2 expression change versus minus log10 adjusted P-values">
        <rect x="44" y="24" width="525" height="234" fill="#f6fbff"/>
        <line x1="44" y1={wy(.05)} x2="569" y2={wy(.05)} stroke="#bd6278" strokeDasharray="5 5"/>
        <line x1={wx(-1)} y1="24" x2={wx(-1)} y2="258" stroke="#8fa6c0" strokeDasharray="4 5"/>
        <line x1={wx(1)} y1="24" x2={wx(1)} y2="258" stroke="#8fa6c0" strokeDasharray="4 5"/>
        {points.map((gene, index) => <circle key={`${gene.geneId}-${index}`} cx={wx(gene.log2FoldChange)}
          cy={wy(gene.fdr)} r={significant(gene) ? 2.7 : 1.7}
          fill={significant(gene) ? "#bf466b" : "#417fb4"}>
          <title>{`${gene.geneId}: log2FC=${gene.log2FoldChange.toFixed(3)}, BH q=${labelP(gene.fdr)}`}</title>
        </circle>)}
        <text x="225" y="298" fontSize="11" fill="#51627a">log2 comparison/reference mean CPM</text>
        <text x="5" y="17" fontSize="10" fill="#51627a">−log10 q</text>
        <text x="44" y="275" fontSize="10" fill="#51627a">−{scaleX}</text>
        <text x="305" y="275" fontSize="10" fill="#51627a">0</text>
        <text x="549" y="275" fontSize="10" fill="#51627a">+{scaleX}</text>
      </svg>
      <p>{points.length.toLocaleString()} of {result.genesTested.toLocaleString()} tested genes shown. Red: q below 0.05 and absolute log2 fold change at least 1. Download includes all tested genes.</p>
    </figure>
    <figure className={styles.chart}>
      <figcaption>Sample PCA: top {result.pcaFeatures} variable tested genes</figcaption>
      <svg viewBox="0 0 590 310" role="img" aria-label="Principal component analysis of sample expression profiles with sample group labels">
        <rect x="40" y="28" width="520" height="232" fill="#f6fbff"/>
        <line x1="300" y1="28" x2="300" y2="260" stroke="#bed0df"/>
        <line x1="40" y1="144" x2="560" y2="144" stroke="#bed0df"/>
        {samples.map((s, i) => <g key={s.sampleId}>
          <circle cx={coord(s.pc1)} cy={coord(s.pc2, true)} r="5" fill={s.group === result.referenceGroup ? "#168f9b" : "#bd5271"}>
            <title>{`${s.sampleId} (${s.group}), library size=${s.librarySize}, size factor=${s.sizeFactor.toFixed(3)}`}</title>
          </circle>
          {samples.length <= 25 && <text x={coord(s.pc1) + 7} y={coord(s.pc2, true) - 5} fontSize="9" fill="#4a6278">{i + 1}</text>}
        </g>)}
        <text x="215" y="291" fontSize="11" fill="#51627a">PC1 ({(result.pcaExplainedVariance[0] * 100).toFixed(1)}%)</text>
        <text x="12" y="18" fontSize="10" fill="#51627a">PC2 ({(result.pcaExplainedVariance[1] * 100).toFixed(1)}%)</text>
      </svg>
      <p><span style={{color: "#168f9b"}}>●</span> {result.referenceGroup} · <span style={{color: "#bd5271"}}>●</span> {result.comparisonGroup}. The axes summarize only these local expression profiles; inspect batch and outlier patterns before interpreting association.</p>
    </figure>
  </div>;
}
export function ExpressionWorkbench() {
  const [counts, setCounts] = useState<File | null>(null);
  const [design, setDesign] = useState<File | null>(null);
  const [minCpm, setMinCpm] = useState(1);
  const [reference, setReference] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => {worker.current?.terminate(); worker.current = null;}, []);
  function cancel() {worker.current?.terminate(); worker.current = null; setRunning(false); setStatus("Cancelled. No analysis was saved or published.");}
  function run() {
    if (running || !counts || !design) return;
    if (counts.size < 1 || counts.size > MAX_COUNT_BYTES || design.size < 1 || design.size > MAX_DESIGN_BYTES) {
      setError("Raw count matrix must be ≤32 MiB; sample design ≤512 KiB."); return;
    }
    setError(""); setEvidence(null); setRunning(true);
    setStatus("Reading raw counts and verifying the sample design locally...");
    const job = new Worker(new URL("./expression.worker.ts", import.meta.url));
    worker.current = job;
    job.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (worker.current !== job) return;
      const message = event.data;
      if (message.kind === "progress") setStatus(`${message.count.toLocaleString()} gene rows inspected locally...`);
      if (message.kind === "complete") {
        setEvidence({result: message.result, countsSha256: message.countsSha256, designSha256: message.designSha256});
        setStatus("Expression normalization, sample PCA, gene statistics and FDR are complete.");
        setRunning(false); job.terminate(); worker.current = null;
      }
      if (message.kind === "error") {
        setError(message.message); setStatus(""); setRunning(false); job.terminate(); worker.current = null;
      }
    };
    job.onerror = () => {setError("Local expression worker failed. No partial results were accepted."); setRunning(false); job.terminate(); worker.current = null;};
    job.postMessage({counts, design, settings: {minCpm, referenceGroup: reference.trim() || undefined}});
  }
  const result = evidence?.result;
  const significant = result?.genes.filter(g => g.fdr < .05 && Math.abs(g.log2FoldChange) >= 1) ?? [];
  const top = result?.genes.slice().sort((a, b) => a.fdr - b.fdr || a.p - b.p).slice(0, 20) ?? [];
  return <div className={styles.workbench}>
    <section className={styles.panel} aria-label="RNA expression input files">
      <div><span className={styles.eyebrow}>STEP 1 / EXISTING READ COUNTS</span><h2>Compare two experimental conditions</h2>
        <p className={styles.intro}>Provide a raw, nonnegative <strong>integer</strong> gene-count matrix with <code>gene_id</code> followed by sample columns, and a matched design table with exactly <code>sample_id</code> and <code>condition</code>. Each condition requires at least three independent biological replicates. CSV and TSV are accepted. This tool starts after read alignment/quantification; it cannot quantify FASTQ.</p></div>
      <div className={styles.inputs}>
        <label>Raw gene counts (.tsv/.csv)
          <input type="file" accept=".tsv,.csv,.txt" disabled={running} onChange={e => {setCounts(e.currentTarget.files?.[0] ?? null); setEvidence(null);}} /></label>
        <label>Sample conditions (.tsv/.csv)
          <input type="file" accept=".tsv,.csv,.txt" disabled={running} onChange={e => {setDesign(e.currentTarget.files?.[0] ?? null); setEvidence(null);}} /></label>
      </div>
      <div className={styles.settings}>
        <label>Minimum expression (CPM)
          <input type="number" min="0" max="100" step="0.5" disabled={running} value={minCpm}
            onChange={e => {setMinCpm(Number(e.currentTarget.value)); setEvidence(null);}} /></label>
        <label>Reference condition (optional)
          <input type="text" maxLength={80} placeholder="Auto: alphabetical first" disabled={running} value={reference}
            onChange={e => {setReference(e.currentTarget.value); setEvidence(null);}} /></label>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={running || !counts || !design} onClick={run}>Analyze expression</button>
        {running && <button type="button" className={styles.secondary} onClick={cancel}>Cancel</button>}
        <button type="button" className={styles.secondary} disabled={running} onClick={() => makeSynthetic("counts")}>Synthetic counts</button>
        <button type="button" className={styles.secondary} disabled={running} onClick={() => makeSynthetic("design")}>Synthetic design</button>
      </div>
      <p className={styles.notes}>Execution is private and local. Up to 50,000 genes, 128 samples, and 4 million gene–sample cells. Files are not uploaded, used to train models, sent to Gemini/Groq, or added to cloud research history.</p>
      {status && <p className={styles.status} role="status">{status}</p>}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </section>
    {result && evidence && <section className={styles.panel} aria-label="Computed RNA expression results">
      <span className={styles.eyebrow}>STEP 2 / COMPLETED LOCALLY</span>
      <h2>Results: {result.comparisonGroup} versus {result.referenceGroup}</h2>
      <div className={styles.metrics}>
        <article><small>Genes evaluated</small><strong>{result.genesSeen.toLocaleString()}</strong></article>
        <article><small>Genes statistically tested</small><strong>{result.genesTested.toLocaleString()}</strong></article>
        <article><small>q below 0.05, |log2FC| ≥ 1</small><strong>{significant.length.toLocaleString()}</strong></article>
        <article><small>Matched biological samples</small><strong>{result.samplesMatched}</strong></article>
      </div>
      <ExpressionPlots result={result} />
      <div className={styles.actions}>
        <button className={styles.primary} type="button" onClick={() => downloadText(expressionTsv(result),"genithm-expression-all-tested-genes.tsv")}>Download all gene statistics</button>
        <button className={styles.secondary} type="button" onClick={() => downloadText(expressionGeneList(result,true),"genithm-expression-selected-genes.tsv")}>Download selected gene IDs</button>
        <button className={styles.secondary} type="button" onClick={() => downloadText(expressionGeneList(result,false),"genithm-expression-measured-background.tsv")}>Download measured background</button>
        <Link className={styles.secondary} href="/dashboard/pathways">Open Pathway Enrichment →</Link>
      </div>
      <p className={styles.notes}>The selected gene list applies q &lt; 0.05 and |log2FC| ≥ 1. Gene-set enrichment requires a GMT file containing IDs in the same namespace. If no genes pass, do not treat that as a negative biological conclusion.</p>
      <div className={styles.tableWrap}><table>
        <caption className="genithm-sr-only">Top 20 genes by adjusted P from actual data</caption>
        <thead><tr><th>Gene ID</th><th>Mean CPM</th><th>log2FC</th><th>Welch P</th><th>BH q</th></tr></thead>
        <tbody>{top.map(g => <tr key={g.geneId}><td>{g.geneId}</td><td>{g.baseMean.toFixed(2)}</td>
          <td>{g.log2FoldChange.toFixed(3)}</td><td>{labelP(g.p)}</td><td>{labelP(g.fdr)}</td></tr>)}</tbody>
      </table></div>
      <details className={styles.provenance}><summary>Methods, warnings and source integrity</summary>
        <p>Engine {EXPRESSION_VERSION}. {result.method}. Reference condition: {result.referenceGroup}. Comparison: {result.comparisonGroup}. Minimum CPM: {result.minCpm}. Genes excluded for low expression: {result.excluded.low_expression}; zero variance: {result.excluded.zero_variance}.</p>
        <p>Count file SHA-256: <code>{evidence.countsSha256}</code></p>
        <p>Sample sheet SHA-256: <code>{evidence.designSha256}</code></p>
        {result.warnings.map(w => <p key={w} className={styles.warning}>{w}</p>)}
        <button className={styles.secondary} type="button" onClick={() => downloadText(JSON.stringify({schema:result.schema,version:result.version,method:result.method,
          count_matrix_sha256:evidence.countsSha256,sample_design_sha256:evidence.designSha256,
          reference_group:result.referenceGroup,comparison_group:result.comparisonGroup,
          samples:result.samplesMatched,genes_seen:result.genesSeen,genes_tested:result.genesTested,
          excluded:result.excluded,warnings:result.warnings},null,2),"genithm-expression-provenance.json","application/json")}>Download provenance JSON</button>
      </details>
    </section>}
  </div>;
}
