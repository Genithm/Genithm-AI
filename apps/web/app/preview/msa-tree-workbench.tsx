"use client";

import { useState, type FormEvent } from "react";
import styles from "./preview.module.css";

type Mode = "msa_conservation" | "msa_phylogeny";
type Site = { position: number; conservation_percent: number | null; gap_percent: number;
  missing_percent: number; known_bases: number; entropy_bits: number | null; consensus: string };
type Tree = { id: number; name: string | null; length: number; support: number | null; children: Tree[] };
type Analysis = {
  input_sha256: string;
  tool: { id: string; version: string; aligner: string; tree_builder: string | null };
  summary: { sequence_type: string; sequence_count: number; input_bases: number;
    alignment_columns: number; completely_conserved_columns: number;
    variable_columns: number; parsimony_informative_columns: number;
    mean_known_base_conservation_percent: number | null };
  result: { records: { name: string; aligned: string; input_length: number }[];
    conservation: Site[]; consensus: string; method: string;
    newick: string | null; tree: Tree | null; phylogeny_note: string | null };
};

const EXAMPLE = ">alpha\nACGTACGTACGT\n>beta\nACGTTGGTACGT\n>gamma\nACGTACGTTGGT\n>delta\nACGTACGTACGA";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ConservationChart({ sites }: { sites: Site[] }) {
  const width = 720;
  const height = 160;
  const x = (i: number) => 35 + (i / Math.max(sites.length - 1, 1)) * 660;
  const y = (value: number) => 130 - value * 1.15;
  const segments: string[][] = [];
  let active: string[] = [];
  sites.forEach((s, i) => {
    if (s.conservation_percent === null) {
      if (active.length > 1) segments.push(active);
      active = [];
    } else {
      active.push(x(i) + "," + y(s.conservation_percent));
    }
  });
  if (active.length > 1) segments.push(active);
  return <div className={styles.gcChart}>
    <svg viewBox={"0 0 " + width + " " + height} role="img"
      aria-label="Per-column conservation percentage from 0 to 100 along the multiple sequence alignment">
      {[0,25,50,75,100].map(tick => <g key={tick}>
        <line x1={35} x2={695} y1={y(tick)} y2={y(tick)} stroke="currentColor"
          strokeOpacity={.16} strokeDasharray="4 5" />
        <text x={27} y={y(tick)+4} fontSize="10" textAnchor="end" fill="currentColor">{tick}</text>
      </g>)}
      {segments.map((part, i) => <polyline key={i} points={part.join(" ")}
        stroke="#86e8cc" fill="none" strokeWidth="2.5" />)}
      {sites.length === 1 && sites[0].conservation_percent !== null ?
        <circle cx={x(0)} cy={y(sites[0].conservation_percent)} r={4} fill="#86e8cc" /> : null}
      <text x={35} y={152} fontSize="10" fill="currentColor">1</text>
      <text x={695} y={152} fontSize="10" textAnchor="end" fill="currentColor">
        {sites.length} aligned columns
      </text>
    </svg>
    <p className={styles.labCaption}>Dominant A/C/G/T percentage among known nucleotides, excluding N and gaps.</p>
  </div>;
}

type PlotNode = { id: number; name: string | null; support: number | null; length: number;
  x: number; y: number; parent: number | null };
function layoutTree(root: Tree) {
  const nodes: PlotNode[] = [];
  let leaf = 0, maximum = 0;
  function visit(n: Tree, parent: number | null, distance: number): number {
    const spot: PlotNode = { id: n.id, name: n.name, support: n.support, length: n.length,
      x: distance, y: 0, parent };
    nodes.push(spot);
    maximum = Math.max(maximum, distance);
    if (!n.children.length) spot.y = (++leaf) * 44;
    else {
      const ys = n.children.map(child => visit(child, n.id, distance + child.length));
      spot.y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    return spot.y;
  }
  visit(root, null, 0);
  const zeroLengths = maximum === 0;
  if (zeroLengths) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    function depth(n: Tree, distance: number) {
      const p = byId.get(n.id)!;
      p.x = distance;
      n.children.forEach(c => depth(c, distance + 1));
    }
    depth(root, 0);
    maximum = Math.max(...nodes.map(n => n.x), 1);
  }
  nodes.forEach(n => { n.x = 24 + n.x / Math.max(maximum, .000001) * 565; });
  return { nodes, height: Math.max(150, (leaf + 1) * 44), zeroLengths };
}

function PhylogeneticTree({ tree }: { tree: Tree }) {
  const { nodes, height, zeroLengths } = layoutTree(tree);
  const byId = new Map(nodes.map(n => [n.id, n]));
  return <div className={styles.matrixScroll}>
    <svg viewBox={"0 0 820 " + height} style={{ width: "100%", minWidth: 620, display: "block" }}
      role="img" aria-label="FastTree unrooted phylogenetic tree shown as a rectangular branch-length diagram">
      {nodes.filter(n => n.parent !== null).map(node => {
        const parent = byId.get(node.parent!)!;
        return <g key={node.id} stroke="#83dac6" strokeWidth="2" fill="none">
          <line x1={parent.x} y1={parent.y} x2={parent.x} y2={node.y} />
          <line x1={parent.x} y1={node.y} x2={node.x} y2={node.y} />
        </g>;
      })}
      {nodes.filter(n => n.name !== null).map(n =>
        <text key={n.id} x={n.x + 8} y={n.y + 4} fill="#d6f4e9"
          fontSize="13">{n.name}</text>)}
      {nodes.filter(n => n.support !== null).map(n =>
        <text key={n.id} x={n.x + 4} y={n.y - 7} fill="#a4b8d8"
          fontSize="10">{n.support?.toFixed(2)}</text>)}
    </svg>
    <p className={styles.labCaption}>
      {zeroLengths ? "Zero branch lengths: horizontal spacing shows topology only." :
        "Horizontal positions reflect estimated relative branch lengths."}
      {" "}The tree is unrooted; layout does not establish evolutionary direction.
      Support labels are FastTree local support values, not bootstrap percentages.
    </p>
  </div>;
}

export function MsaTreeWorkbench() {
  const [mode, setMode] = useState<Mode>("msa_phylogeny");
  const [sequenceType, setSequenceType] = useState<"dna" | "rna">("dna");
  const [fasta, setFasta] = useState(EXAMPLE);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const clear = () => { setData(null); setError(""); };

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); clear();
    try {
      const response = await fetch("/api/dev-science", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ sequence: fasta, sequence_type: sequenceType,
          operation: mode, motif: null, min_aa: 30 }),
      });
      const result = await response.json() as Analysis & { error?: string };
      if (!response.ok) { setError(result.error || "MAFFT/FastTree could not complete the analysis."); return; }
      setData(result);
    } catch {
      setError("The local scientific engine is unavailable. Restart Codespaces and check MAFFT/FastTree installation.");
    } finally { setBusy(false); }
  }

  function exportResult(format: "json" | "fasta" | "csv" | "newick") {
    if (!data) return;
    if (format === "json") {
      download("genithm-msa.json", JSON.stringify(data, null, 2), "application/json");
    } else if (format === "fasta") {
      download("genithm-msa.fasta", data.result.records.map(r => ">" + r.name + "\n" + r.aligned).join("\n") + "\n", "text/plain");
    } else if (format === "csv") {
      const rows = data.result.conservation.map(s =>
        [s.position, s.conservation_percent ?? "", s.gap_percent, s.missing_percent,
          s.known_bases, s.entropy_bits ?? "", s.consensus].join(","));
      download("genithm-conservation.csv",
        "column,conservation_percent,gap_percent,missing_percent,known_bases,entropy_bits,consensus\n" +
        rows.join("\n") + "\n", "text/csv");
    } else if (data.result.newick) {
      download("genithm-tree.nwk", data.result.newick + "\n", "text/plain");
    }
  }

  return <section className={styles.liveLab} aria-labelledby="msa-title">
    <div className={styles.sectionHeading}>
      <div>
        <div className={styles.kicker}>Science V5 · real multiple alignment & phylogenetics</div>
        <h2 id="msa-title">Discover conservation and evolutionary patterns</h2>
        <p className={styles.liveIntro}>MAFFT multiple sequence alignment, conservation,
          consensus and optional unrooted FastTree topology from your DNA/RNA FASTA sample.</p>
      </div>
      <span className={styles.sampleTag}>3–8 SEQUENCES · 300 NT EACH</span>
    </div>
    <div className={styles.labGrid}>
      <form className={styles.labForm} onSubmit={run}>
        <div className={styles.labTopline}><strong>01 / Multiple FASTA records</strong>
          <span>Private Codespaces execution</span></div>
        <label htmlFor="msa-method">Scientific operation
          <select id="msa-method" className={styles.labControl} value={mode}
            onChange={e => { setMode(e.target.value as Mode); clear(); }}>
            <option value="msa_phylogeny">MSA + conservation + FastTree</option>
            <option value="msa_conservation">MSA + conservation only</option>
          </select>
        </label>
        <label htmlFor="msa-type">Nucleotide type
          <select id="msa-type" className={styles.labControl} value={sequenceType}
            onChange={e => { setSequenceType(e.target.value as "dna" | "rna"); clear(); }}>
            <option value="dna">DNA</option><option value="rna">RNA</option>
          </select>
        </label>
        <label htmlFor="msa-fasta">Three to eight named, ungapped nucleotide FASTA records
          <textarea id="msa-fasta" className={styles.labSequence} rows={12}
            maxLength={5500} value={fasta} onChange={e => { setFasta(e.target.value); clear(); }}
            required spellCheck={false} autoCapitalize="off" />
        </label>
        <div className={styles.labActions}>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Analyzing…" : "Run real MSA"}
          </button>
          <button type="button" className="button" disabled={busy}
            onClick={() => { setFasta(EXAMPLE); setSequenceType("dna"); clear(); }}>Restore example</button>
        </div>
        <p className={styles.labCaption}>Sequences are bounded and ephemeral. Local MAFFT and
          FastTree binaries are required. No Supabase, Oracle, research-job submission or AI key.</p>
      </form>
      <div className={styles.labOutput} aria-live="polite" aria-busy={busy}>
        <div className={styles.labTopline}><strong>02 / Scientific output</strong>
          <span>{data ? "Computed locally" : "Ready"}</span></div>
        {error ? <div className={styles.labError} role="alert">{error}</div> : null}
        {!data && !error ? <div className={styles.labEmpty}>
          <span className={styles.labGlyph} aria-hidden="true">≋</span>
          <strong>{busy ? "Running MAFFT and FastTree…" : "Align your sequences"}</strong>
          <p>Paste a small multi-record DNA/RNA FASTA sample, then calculate conservation and optional tree.</p>
        </div> : null}
        {data ? <div className={styles.labReport}>
          <div className={styles.labResultHead}>
            <div><span className={styles.sidebarLabel}>REAL SCIENTIFIC BINARIES · UNSIGNED DEVELOPMENT OUTPUT</span>
              <h3>Multiple sequence alignment</h3>
            </div>
            <div className={styles.labActions}>
              <button type="button" className="button compact" onClick={() => exportResult("json")}>JSON</button>
              <button type="button" className="button compact" onClick={() => exportResult("fasta")}>Aligned FASTA</button>
              <button type="button" className="button compact" onClick={() => exportResult("csv")}>Conservation CSV</button>
              {data.result.newick ? <button type="button" className="button compact"
                onClick={() => exportResult("newick")}>Newick</button> : null}
            </div>
          </div>
          <div className={styles.comparisonStatStrip}>
            <div><span>Sequences</span><strong>{data.summary.sequence_count}</strong></div>
            <div><span>Aligned columns</span><strong>{data.summary.alignment_columns}</strong></div>
            <div><span>Fully conserved</span><strong>{data.summary.completely_conserved_columns}</strong></div>
            <div><span>Variable sites</span><strong>{data.summary.variable_columns}</strong></div>
            <div><span>Informative sites</span><strong>{data.summary.parsimony_informative_columns}</strong></div>
            <div><span>Mean conservation</span><strong>{data.summary.mean_known_base_conservation_percent == null ?
              "N/A" : data.summary.mean_known_base_conservation_percent + "%"}</strong></div>
          </div>
          <div className={styles.labDataSection}>
            <h4>Multiple alignment and consensus</h4>
            <div className={styles.alignmentChunk} style={{ overflowX: "auto" }}>
              {data.result.records.map(r => <div className={styles.alignmentTrack} key={r.name}>
                <span className={styles.msaLabel}>{r.name}</span><code>{r.aligned}</code></div>)}
              <div className={styles.alignmentTrack}><span className={styles.msaLabel}>Consensus</span>
                <code style={{ color: "#9fe4c4" }}>{data.result.consensus}</code></div>
            </div>
          </div>
          <div className={styles.labDataSection}>
            <h4>Per-column conservation</h4>
            <ConservationChart sites={data.result.conservation} />
          </div>
          {data.result.tree ? <div className={styles.labDataSection}>
            <h4>Approximate maximum-likelihood tree</h4>
            <PhylogeneticTree tree={data.result.tree} />
            <p className={styles.labCaption}>{data.result.phylogeny_note}</p>
          </div> : null}
          <p className={styles.labCaption}>{data.result.method}</p>
          <div className={styles.labHash}>
            <span>Canonical input SHA-256</span><code>{data.input_sha256}</code>
            <span>{data.tool.aligner} + {data.tool.tree_builder || "conservation"}
              {" "}· local, unsaved, unsigned</span>
          </div>
        </div> : null}
      </div>
    </div>
  </section>;
}
