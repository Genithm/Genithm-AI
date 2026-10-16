"use client";

import { useEffect, useMemo, useState } from "react";

import type { ExplorerResult } from "@/lib/scientific-result-explorer";
import { verifiedExplorerTsv } from "@/lib/verified-explorer-export";
import styles from "./scientific-explorer.module.css";

type ExplorerResponse = { verification: string; sha256: string; jobType: string; view: ExplorerResult };
const WIDTH = 96;
const PAGE_ROWS = 12;

function count(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : "n/a";
}
function pct(value: number) {
  return (value * 100).toFixed(1) + "%";
}

function TreeView({ view }: { view: Extract<ExplorerResult, { kind: "tree" }> }) {
  const { nodes, paths, width, height } = useMemo(() => {
    const all = view.nodes;
    const children = new Map<number, number[]>();
    for (const n of all) {
      if (n.parent !== null) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
    }
    const depths = new Map<number, number>();
    const distances = new Map<number, number>();
    const visit = (id: number, level: number, distance: number) => {
      depths.set(id, level);
      distances.set(id, distance);
      for (const child of children.get(id) ?? []) {
        visit(child, level + 1, distance + all[child].length);
      }
    };
    visit(0, 0, 0);
    const leaves = all.filter(n => n.label);
    const y = new Map<number, number>();
    leaves.forEach((leaf, i) => y.set(leaf.id, 26 + i * 28));
    const place = (id: number): number => {
      const kid = children.get(id) ?? [];
      if (!kid.length) return y.get(id) ?? 26;
      const values = kid.map(place);
      const cy = (Math.min(...values) + Math.max(...values)) / 2;
      y.set(id, cy);
      return cy;
    };
    place(0);
    const maxDist = Math.max(0, ...Array.from(distances.values()));
    const maxDepth = Math.max(1, ...Array.from(depths.values()));
    const x = new Map<number, number>();
    for (const n of all) {
      const proportion = maxDist > 0
        ? (distances.get(n.id) ?? 0) / maxDist
        : (depths.get(n.id) ?? 0) / maxDepth;
      x.set(n.id, 24 + 640 * proportion);
    }
    const paths = all.filter(n => n.parent !== null).map(n => ({
      id: n.id,
      d: "M " + x.get(n.parent!) + " " + y.get(n.parent!) +
         " V " + y.get(n.id) + " H " + x.get(n.id),
      support: n.support,
    }));
    return { nodes: all.map(n => ({
      ...n, x: x.get(n.id) ?? 0, y: y.get(n.id) ?? 0,
    })), paths, width: 840, height: Math.max(120, 52 + leaves.length * 28) };
  }, [view]);

  return (
    <div className={styles.treeScroller}>
      <svg className={styles.tree} viewBox={"0 0 " + width + " " + height}
        role="img" aria-label={"Unrooted FastTree topology shown as a layout; " + view.leaves + " tips and model " + view.model}>
        {paths.map(path => <path key={path.id} d={path.d} fill="none" stroke="currentColor"
          strokeWidth="1.5" opacity=".68" />)}
        {nodes.map(n => n.label ? (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="3" fill="currentColor" />
            <text x={n.x + 9} y={n.y + 4} fill="currentColor" fontSize="13">{n.label}</text>
          </g>
        ) : n.support !== null ? (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="4" fill="currentColor" />
            <title>{"FastTree local support: " + n.support.toFixed(3)}</title>
          </g>
        ) : null)}
      </svg>
    </div>
  );
}

function WindowControls({ start, total, onChange }: {
  start: number; total: number; onChange: (next: number) => void;
}) {
  return (
    <div className={styles.windowControls}>
      <span className={styles.small}>Alignment columns {count(start + 1)}–{count(Math.min(total, start + WIDTH))} of {count(total)}</span>
      <div className={styles.buttons}>
        <button type="button" onClick={() => onChange(Math.max(0, start - WIDTH))} disabled={start === 0}
          aria-label="Previous alignment columns">← Previous</button>
        <button type="button" onClick={() => onChange(start + WIDTH)} disabled={start + WIDTH >= total}
          aria-label="Next alignment columns">Next →</button>
      </div>
    </div>
  );
}

function AlignmentView({ view, onWindow, onRow }: {
  view: Extract<ExplorerResult, { kind: "msa" | "pairwise" }>;
  onWindow: (n: number) => void; onRow: (n: number) => void;
}) {
  if (view.kind === "pairwise") {
    return (
      <>
        <div className={styles.kpiRow}>
          <span><b>{count(view.match)}</b> matches</span>
          <span><b>{count(view.mismatch)}</b> mismatches</span>
          <span><b>{count(view.gaps)}</b> gap columns</span>
        </div>
        <WindowControls start={view.offset} total={view.total} onChange={onWindow} />
        <div className={styles.sequenceScroller} tabIndex={0} aria-label="Scrollable pairwise alignment">
          <div className={styles.sequenceLine}><strong>Sequence A</strong><code>{view.a}</code></div>
          <div className={styles.sequenceLine}><strong>Concordance</strong><code>{view.markers}</code></div>
          <div className={styles.sequenceLine}><strong>Sequence B</strong><code>{view.b}</code></div>
        </div>
        <p className={styles.small}>“|” identical residue · “.” mismatch · blank indicates gap. Identity and scores are based on the recorded alignment, not inferred biological function.</p>
      </>
    );
  }
  return (
    <>
      <div className={styles.kpiRow}>
        <span><b>{count(view.sequenceCount)}</b> sequences</span>
        <span><b>{count(view.total)}</b> columns</span>
        <span><b>{count(view.samples.length)}</b> conservation samples</span>
      </div>
      <div className={styles.chartTitle}>Column conservation <span>(non-gap majority fraction)</span></div>
      <div className={styles.conservation} role="img"
        aria-label={"Sampled per-column sequence conservation, " + view.samples.length + " observations"}>
        {view.samples.map((p, i) => (
          <span key={i} className={styles.chartBar}
            style={{ height: String(Math.round(100 * p.conservation)) + "%", opacity: String(1 - p.gapFraction * 0.55) }}
            title={"Column " + p.position + ": " + pct(p.conservation) + " conservation; " + pct(p.gapFraction) + " gaps"} />
        ))}
      </div>
      <p className={styles.small}>This is a {view.sampled ? "uniformly sampled" : "complete"} visualization of column majority agreement, excluding gaps from the denominator. It is not a statistically inferred conservation score or evolutionary support.</p>
      <WindowControls start={view.offset} total={view.total} onChange={onWindow} />
      <div className={styles.sequenceScroller} tabIndex={0} aria-label="Scrollable multiple sequence alignment">
        {view.rows.map(r => <div className={styles.sequenceLine} key={r.id}>
          <strong>{r.id}</strong><code>{r.bases}</code>
        </div>)}
      </div>
      {view.sequenceCount > PAGE_ROWS ? (
        <div className={styles.windowControls}>
          <span className={styles.small}>Sequences {view.rowOffset + 1}–{Math.min(view.rowOffset + PAGE_ROWS, view.sequenceCount)} of {view.sequenceCount}</span>
          <div className={styles.buttons}>
            <button type="button" disabled={view.rowOffset === 0} onClick={() => onRow(Math.max(0, view.rowOffset - PAGE_ROWS))}>↑ Earlier sequences</button>
            <button type="button" disabled={view.rowOffset + PAGE_ROWS >= view.sequenceCount} onClick={() => onRow(view.rowOffset + PAGE_ROWS)}>↓ More sequences</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ScientificResultExplorerPanel({ jobId }: { jobId: string }) {
  const [offset, setOffset] = useState(0);
  const [rowOffset, setRowOffset] = useState(0);
  const [payload, setPayload] = useState<ExplorerResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setPayload(null);
    const url = "/dashboard/scientific-jobs/" + encodeURIComponent(jobId) +
      "/explore?offset=" + offset + "&row=" + rowOffset;
    fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 409
          ? "The stored scientific result could not be verified or parsed safely."
          : res.status === 401 ? "Please sign in to view this result."
          : "The scientific result is currently unavailable.");
        return res.json() as Promise<ExplorerResponse>;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        if (data.verification !== "sha256-verified" || !data.view) {
          throw new Error("Scientific result verification information is missing.");
        }
        setPayload(data);
        setState("ready");
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to load scientific result.");
        setState("error");
      });
    return () => controller.abort();
  }, [jobId, offset, rowOffset, retry]);

  function exportVerifiedViewport() {
    if (state !== "ready" || !payload) return;
    try {
      const tsv = verifiedExplorerTsv(payload);
      const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "genithm-verified-view-" + jobId.slice(0, 8) + ".tsv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportError("");
    } catch {
      setExportError("This verified view could not be exported.");
    }
  }

  return (
    <section className={styles.panel} aria-label="Interactive scientific results">
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>Verified scientific data</div>
          <h2>Explore your analysis</h2>
          <p>Inspect underlying results, alignment columns and phylogenetic relationships without leaving the research workspace.</p>
        </div>
        {state === "ready" ? (
          <div className={styles.exportActions}>
            <div className={styles.verified}>✓ SHA-256 verified</div>
            <button className={styles.exportButton} type="button" onClick={exportVerifiedViewport}>
              ↓ Export visible data (TSV)
            </button>
          </div>
        ) : null}
      </div>
      {exportError ? <p className={styles.message} role="alert">{exportError}</p> : null}
      {state === "loading" ? <div className={styles.message} role="status">Retrieving and verifying the private scientific artifact…</div> : null}
      {state === "error" ? <div className={styles.message} role="alert">
        <strong>Result explorer unavailable</strong><p>{error}</p>
        <button type="button" onClick={() => setRetry(x => x + 1)}>Retry verification</button>
      </div> : null}
      {state === "ready" && payload ? (
        <div className={styles.content}>
          {(payload.view.kind === "pairwise" || payload.view.kind === "msa") ? (
            <AlignmentView view={payload.view} onWindow={setOffset} onRow={setRowOffset} />
          ) : null}
          {payload.view.kind === "tree" ? (
            <>
              <div className={styles.kpiRow}>
                <span><b>{payload.view.leaves}</b> leaves</span><span><b>{payload.view.model}</b> model</span>
              </div>
              <TreeView view={payload.view} />
              <p className={styles.small}>Branch-length layout of the FastTree Newick result. Root placement is for display only; it is not a biological rooting claim. Circle tooltips show available local support values.</p>
            </>
          ) : null}
          {payload.view.kind === "insights" ? (
            <>
              <div className={styles.kpiRow}>
                <span><b>{payload.view.operation.replaceAll("_", " ")}</b> operation</span>
                <span><b>{count(payload.view.sequenceLength)}</b> bases</span>
                {payload.view.totalHits !== null ? <span><b>{count(payload.view.totalHits)}</b> reported findings</span> : null}
              </div>
              {payload.view.sampleSequence !== null ? (
                <div className={styles.sequenceScroller} tabIndex={0}>
                  <div className={styles.small}>Reverse-complement sequence (first {payload.view.sampleSequence.length} bases)</div>
                  <code className={styles.sequenceSample}>{payload.view.sampleSequence}</code>
                </div>
              ) : null}
              <div className={styles.evidenceList}>
                {payload.view.records.map((r, i) => <div className={styles.evidenceItem} key={i}>
                  <strong>{r.label}</strong><span>{r.detail}</span>
                  {r.sequence !== null ? <code>{r.sequence}</code> : null}
                </div>)}
                {!payload.view.records.length && payload.view.sampleSequence === null ?
                  <p className={styles.small}>No result rows reported for this analysis.</p> : null}
              </div>
              {payload.view.truncated ? <p className={styles.small}>Only the first 48 evidence rows are displayed. Download the original artifact for the full record.</p> : null}
              <p className={styles.small}>Coordinates are 1-based inclusive; these are computational findings, not experimental confirmation.</p>
            </>
          ) : null}
          {payload.view.kind === "protein" ? (
            <>
              <div className={styles.kpiRow}><span><b>{count(payload.view.length)}</b> amino acids</span></div>
              <div className={styles.properties}>
                {payload.view.properties.map(p => <div key={p.label}><span>{p.label}</span><strong>{p.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong></div>)}
              </div>
              <h3 className={styles.chartTitle}>Amino-acid composition</h3>
              <div className={styles.residues}>
                {payload.view.composition.map(p => <div key={p.residue} className={styles.residue}>
                  <span>{p.residue}</span>
                  <div className={styles.residueTrack}><i style={{ width: pct(p.count / (payload.view.kind === "protein" ? payload.view.length : 1)) }} /></div>
                  <strong>{p.count}</strong>
                </div>)}
              </div>
              <p className={styles.small}>Charges, pI and hydropathy are model-based estimates; post-translational modifications and experimental conditions are not modeled.</p>
            </>
          ) : null}
          <div className={styles.provenance}>Verified against stored SHA-256 <code>{payload.sha256}</code><p>The TSV contains only this bounded explorer projection. For the complete scientific artifact, use the authenticated raw result download above.</p></div>
        </div>
      ) : null}
    </section>
  );
}
