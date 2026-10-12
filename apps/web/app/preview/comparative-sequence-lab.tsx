"use client";

import { useState, type FormEvent } from "react";

import styles from "./preview.module.css";

type Operation = "pairwise_global" | "pairwise_local" | "comparison_matrix";
type PairResult = {
  record_a: { name: string; length: number };
  record_b: { name: string; length: number };
  aligned_a: string;
  aligned_b: string;
  comparison: string;
  method: string;
  identity_denominator: string;
};
type MatrixResult = {
  records: { name: string; length: number }[];
  identity_matrix: number[][];
  pairs: { record_a: string; record_b: string; identity_percent: number; alignment_length: number; score: number; gaps: number }[];
  method: string;
};
type ResponseData = {
  mode: string;
  persistence: string;
  summary: {
    operation: Operation; sequence_type: string; sequence_count: number; total_bases: number;
    score_scheme: { match_score: number; mismatch_score: number; gap_score: number };
    score?: number; identity_percent?: number; alignment_length?: number; matches?: number;
    mismatches?: number; gap_columns?: number; coverage_a_percent?: number; coverage_b_percent?: number;
    comparisons?: number;
  };
  result: PairResult | MatrixResult;
  input_sha256: string;
  tool: { id: string; version: string };
};

const pairSample = ">reference\nACGTTGCA\n>query\nACGTCGCA";
const matrixSample = ">alpha\nACGTACGT\n>beta\nACGTTCGT\n>gamma\nACGTACGA";

function isMatrix(result: PairResult | MatrixResult): result is MatrixResult {
  return "identity_matrix" in result;
}

function outputFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const element = document.createElement("a");
  element.href = url;
  element.download = filename;
  element.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AlignmentView({ data }: { data: PairResult }) {
  const rows: { a: string; b: string; comparison: string }[] = [];
  const width = 60;
  for (let index = 0; index < data.aligned_a.length; index += width) {
    rows.push({
      a: data.aligned_a.slice(index, index + width),
      b: data.aligned_b.slice(index, index + width),
      comparison: data.comparison.slice(index, index + width),
    });
  }
  if (!rows.length) return <p className={styles.labCaption}>No positive-scoring local alignment was found.</p>;
  return (
    <div className={styles.alignmentBlocks} aria-label="Color-coded aligned nucleotides, matches, mismatches and gaps">
      {rows.map((chunk, index) => (
        <div className={styles.alignmentChunk} key={index}>
          <div className={styles.alignmentTrack}><span className={styles.alignmentTag}>A</span>
            <code>{Array.from(chunk.a).map((letter, i) => (
              <span key={i} className={letter === "-" ? styles.compareGap : chunk.comparison[i] === "|" ? styles.compareMatch : styles.compareMismatch}>{letter}</span>
            ))}</code>
          </div>
          <div className={styles.alignmentTrack}><span className={styles.alignmentTag}> </span>
            <code>{chunk.comparison}</code>
          </div>
          <div className={styles.alignmentTrack}><span className={styles.alignmentTag}>B</span>
            <code>{Array.from(chunk.b).map((letter, i) => (
              <span key={i} className={letter === "-" ? styles.compareGap : chunk.comparison[i] === "|" ? styles.compareMatch : styles.compareMismatch}>{letter}</span>
            ))}</code>
          </div>
        </div>
      ))}
      <p className={styles.labCaption}>
        <span className={styles.compareLegendMatch}>■</span> match &nbsp;
        <span className={styles.compareLegendMismatch}>■</span> mismatch &nbsp;
        <span className={styles.compareLegendGap}>■</span> gap. The middle row uses | for match and . for mismatch.
      </p>
    </div>
  );
}

function MatrixView({ data }: { data: MatrixResult }) {
  return (
    <div className={styles.matrixScroll}>
      <table className={styles.comparisonMatrix}>
        <caption>Percent identical alignment columns for each independent global pairwise comparison</caption>
        <thead><tr><th scope="col">Sequence</th>{data.records.map(record => (
          <th key={record.name} scope="col">{record.name}</th>
        ))}</tr></thead>
        <tbody>{data.records.map((record, i) => (
          <tr key={record.name}>
            <th scope="row">{record.name}<small>{record.length} nt</small></th>
            {data.identity_matrix[i].map((value, j) => (
              <td key={data.records[j].name} style={{ backgroundColor: `rgba(57, 170, 148, ${(value / 100) * .45 + .05})` }}>
                {value.toFixed(1)}%
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function ComparativeSequenceLab() {
  const [operation, setOperation] = useState<Operation>("pairwise_global");
  const [sequenceType, setSequenceType] = useState<"dna" | "rna">("dna");
  const [fasta, setFasta] = useState(pairSample);
  const [data, setData] = useState<ResponseData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function selectOperation(next: Operation) {
    setOperation(next);
    setData(null);
    setError("");
    setFasta(next === "comparison_matrix" ? matrixSample : pairSample);
    setSequenceType("dna");
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setData(null);
    try {
      const response = await fetch("/api/dev-science", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequence: fasta, sequence_type: sequenceType,
          operation, motif: null, min_aa: 30,
        }),
        cache: "no-store",
      });
      const result = await response.json() as ResponseData & { error?: string };
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "Comparison failed.");
        return;
      }
      setData(result);
    } catch {
      setError("The local scientific engine is unavailable. Restart the Codespace to activate it.");
    } finally {
      setBusy(false);
    }
  }

  function exportExtra() {
    if (!data) return;
    if (isMatrix(data.result)) {
      const names = data.result.records.map(record => record.name);
      const lines = [["sequence", ...names].join("\t"),
        ...data.result.identity_matrix.map((row, i) =>
          [names[i], ...row.map(v => v.toFixed(6))].join("\t"))];
      outputFile("genithm-identity-matrix.tsv", lines.join("\n") + "\n", "text/tab-separated-values");
    } else {
      outputFile("genithm-pairwise-alignment.fasta",
        `>${data.result.record_a.name}\n${data.result.aligned_a}\n>${data.result.record_b.name}\n${data.result.aligned_b}\n`,
        "text/plain");
    }
  }

  return (
    <section className={styles.liveLab} aria-labelledby="comparative-lab-title">
      <div className={styles.sectionHeading}>
        <div>
          <div className={styles.kicker}>Comparative bioinformatics · local sequence engine</div>
          <h2 id="comparative-lab-title">Compare DNA and RNA sequences</h2>
          <p className={styles.liveIntro}>
            Align two sequences globally or locally, or compare three to six short sequences in a
            pairwise-identity matrix. Results are calculated inside Codespaces, without Supabase.
          </p>
        </div>
        <span className={styles.sampleTag}>LIVE · BOUNDED ANALYSIS</span>
      </div>

      <div className={styles.labGrid}>
        <form className={styles.labForm} onSubmit={analyze}>
          <div className={styles.labTopline}><strong>01 / Comparison inputs</strong><span>Two to six FASTA records</span></div>
          <label htmlFor="compare-method">Comparison method
            <select id="compare-method" className={styles.labControl} value={operation}
              onChange={e => selectOperation(e.target.value as Operation)}>
              <option value="pairwise_global">Global pairwise alignment</option>
              <option value="pairwise_local">Local pairwise alignment</option>
              <option value="comparison_matrix">3–6 sequence identity matrix</option>
            </select>
          </label>
          <label htmlFor="compare-type">Sequence type
            <select id="compare-type" className={styles.labControl} value={sequenceType}
              onChange={e => { setSequenceType(e.target.value as "dna" | "rna"); setData(null); }}>
              <option value="dna">DNA</option>
              <option value="rna">RNA</option>
            </select>
          </label>
          <label htmlFor="compare-fasta">FASTA sequences (unique IDs and ungapped nucleotides)
            <textarea id="compare-fasta" className={styles.labSequence} rows={11}
              value={fasta} onChange={e => { setFasta(e.target.value); setData(null); }}
              maxLength={5500} required spellCheck={false} autoCapitalize="off" />
          </label>
          <div className={styles.labActions}>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? "Aligning…" : "Run sequence comparison"}
            </button>
            <button className="button" type="button" disabled={busy} onClick={() => {
              setFasta(operation === "comparison_matrix" ? matrixSample : pairSample);
              setSequenceType("dna"); setData(null); setError("");
            }}>Restore example</button>
          </div>
          <p className={styles.labCaption}>
            Pairwise: exactly 2 sequences, at most 700 bases each. Matrix: 3–6 sequences,
            at most 150 bases each. Scoring: match +2, mismatch −1, gap −2 (linear gap).
            Unknown N matches only N. No data is saved.
          </p>
        </form>

        <div className={styles.labOutput} aria-live="polite" aria-busy={busy}>
          <div className={styles.labTopline}><strong>02 / Comparative results</strong>
            <span>{data ? "Calculated locally" : "Ready to compare"}</span>
          </div>
          {error ? <div className={styles.labError} role="alert">{error}</div> : null}
          {!data && !error ? (
            <div className={styles.labEmpty}>
              <span className={styles.labGlyph} aria-hidden="true">≋</span>
              <strong>{busy ? "Computing alignments…" : "Explore real sequence differences"}</strong>
              <p>Select global or local alignment, or the identity matrix, then run the comparison.</p>
            </div>
          ) : null}
          {data ? (
            <div className={styles.labReport}>
              <div className={styles.labResultHead}>
                <div><span className={styles.sidebarLabel}>SCIENTIFIC COMPUTATION · LOCAL / UNSIGNED</span>
                  <h3>{operation === "comparison_matrix" ? "Pairwise identity matrix" : operation === "pairwise_global" ? "Global alignment" : "Local alignment"}</h3>
                </div>
                <div className={styles.labActions}>
                  <button className="button compact" type="button"
                    onClick={() => outputFile("genithm-comparison.json", JSON.stringify(data, null, 2), "application/json")}>Export JSON</button>
                  <button className="button compact" type="button" onClick={exportExtra}>
                    Export {isMatrix(data.result) ? "TSV matrix" : "aligned FASTA"}
                  </button>
                </div>
              </div>
              {isMatrix(data.result) ? (
                <>
                  <div className={styles.comparisonStatStrip}>
                    <div><span>Sequences</span><strong>{data.summary.sequence_count}</strong></div>
                    <div><span>Pairwise comparisons</span><strong>{data.summary.comparisons}</strong></div>
                    <div><span>Input bases</span><strong>{data.summary.total_bases}</strong></div>
                  </div>
                  <MatrixView data={data.result} />
                  <div className={styles.labScroll}>
                    {data.result.pairs.map(row => (
                      <div className={styles.labDataRow} key={row.record_a + "/" + row.record_b}>
                        <strong>{row.record_a} / {row.record_b}</strong>
                        <span>{row.identity_percent.toFixed(2)}% identity · {row.alignment_length} columns · score {row.score}</span>
                      </div>
                    ))}
                  </div>
                  <p className={styles.labCaption}>{data.result.method}</p>
                </>
              ) : (
                <>
                  <div className={styles.comparisonStatStrip}>
                    <div><span>Identity</span><strong>{data.summary.identity_percent?.toFixed(2)}%</strong></div>
                    <div><span>Alignment score</span><strong>{data.summary.score}</strong></div>
                    <div><span>Gap columns</span><strong>{data.summary.gap_columns}</strong></div>
                    <div><span>Matches</span><strong>{data.summary.matches}</strong></div>
                    <div><span>Mismatches</span><strong>{data.summary.mismatches}</strong></div>
                    <div><span>Aligned columns</span><strong>{data.summary.alignment_length}</strong></div>
                  </div>
                  <p className={styles.labCaption}>{data.result.method} · {data.result.record_a.name} / {data.result.record_b.name} ·
                    Input coverage {data.summary.coverage_a_percent}% / {data.summary.coverage_b_percent}%
                  </p>
                  <AlignmentView data={data.result} />
                  <p className={styles.labCaption}>{data.result.identity_denominator}
                    {" "}Local alignments report their best-scoring segment, not a whole-sequence similarity estimate.
                  </p>
                </>
              )}
              <div className={styles.labHash}>
                <span>Canonical multi-FASTA SHA-256</span>
                <code>{data.input_sha256}</code>
                <span>Engine {data.tool.id} v{data.tool.version} · local, unsigned computation</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
