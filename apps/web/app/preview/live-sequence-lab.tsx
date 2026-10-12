"use client";

import { useState, type FormEvent } from "react";

import styles from "./preview.module.css";
import { CompositionReport, type CompositionResult } from "./composition-report";

type Operation = "orf_scan" | "six_frame_translation" | "motif_scan" | "reverse_complement" | "composition_profile";
type LabResult = {
  mode: string;
  persistence: string;
  input_sha256: string;
  tool: { id: string; version: string };
  summary: Record<string, string | number>;
  result: {
    orfs?: { strand: string; frame: number; start_1based: number; end_1based: number; protein: string; amino_acids: number }[];
    frames?: { strand: string; frame: number; protein: string }[];
    hits?: { strand: string; start_1based: number; end_1based: number }[];
    reverse_complement?: string;
    truncated?: boolean;
    gc_profile?: CompositionResult["gc_profile"];
    nucleotide_counts?: CompositionResult["nucleotide_counts"];
    codon_usage?: CompositionResult["codon_usage"];
  };
};

const methods: { value: Operation; label: string }[] = [
  { value: "orf_scan", label: "Find complete ORFs" },
  { value: "six_frame_translation", label: "Six-frame translation" },
  { value: "motif_scan", label: "IUPAC motif scanning" },
  { value: "reverse_complement", label: "Reverse complement" },
  { value: "composition_profile", label: "GC content & sequence quality" },
];

export function LiveSequenceLab() {
  const [sequence, setSequence] = useState(">my-sequence\nATGAAATAA");
  const [sequenceType, setSequenceType] = useState<"dna" | "rna">("dna");
  const [operation, setOperation] = useState<Operation>("orf_scan");
  const [motif, setMotif] = useState("AAA");
  const [minAa, setMinAa] = useState("2");
  const [result, setResult] = useState<LabResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    setError("");
    const payload = {
      sequence,
      sequence_type: sequenceType,
      operation,
      motif: operation === "motif_scan" ? motif.trim().toUpperCase() : null,
      min_aa: operation === "orf_scan" ? Number(minAa) : 30,
    };
    try {
      const response = await fetch("/api/dev-science", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = await response.json() as LabResult & { error?: string };
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Scientific analysis failed.");
        return;
      }
      setResult(data);
    } catch {
      setError("Local scientific engine is unavailable. Restart your Codespace to activate it.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `genithm-local-${operation}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.liveLab} aria-labelledby="interactive-lab-title">
      <div className={styles.sectionHeading}>
        <div>
          <div className={styles.kicker}>Live local computation · Python science engine</div>
          <h2 id="interactive-lab-title">Analyze your own DNA or RNA</h2>
          <p className={styles.liveIntro}>
            Paste a single sequence or FASTA and run real Genithm scientific algorithms inside Codespaces.
            This private development lab does not upload or save the sequence.
          </p>
        </div>
        <span className={styles.sampleTag}>MAX 5,000 BASES</span>
      </div>

      <div className={styles.labGrid}>
        <form className={styles.labForm} onSubmit={analyze}>
          <div className={styles.labTopline}><strong>01 / Input sequence</strong><span>Local execution only</span></div>
          <label htmlFor="lab-sequence">DNA / RNA (single FASTA record or plain nucleotides)</label>
          <textarea
            id="lab-sequence"
            className={styles.labSequence}
            value={sequence}
            onChange={(e) => { setSequence(e.target.value); setResult(null); }}
            maxLength={5500}
            required
            spellCheck={false}
            autoCapitalize="off"
          />

          <div className={styles.labTwoColumns}>
            <label htmlFor="lab-type">Sequence type
              <select id="lab-type" className={styles.labControl}
                value={sequenceType} onChange={(e) => { setSequenceType(e.target.value as "dna" | "rna"); setResult(null); }}>
                <option value="dna">DNA</option>
                <option value="rna">RNA</option>
              </select>
            </label>
            <label htmlFor="lab-operation">Analysis operation
              <select id="lab-operation" className={styles.labControl}
                value={operation} onChange={(e) => { setOperation(e.target.value as Operation); setResult(null); }}>
                {methods.map((method) => <option value={method.value} key={method.value}>{method.label}</option>)}
              </select>
            </label>
          </div>

          {operation === "orf_scan" ? (
            <label htmlFor="lab-min-aa">Minimum ORF peptide length (amino acids)
              <input id="lab-min-aa" type="number" min={1} max={1000} step={1}
                value={minAa} onChange={(e) => { setMinAa(e.target.value); setResult(null); }} required />
            </label>
          ) : null}
          {operation === "motif_scan" ? (
            <label htmlFor="lab-motif">IUPAC nucleotide motif (2–32 symbols)
              <input id="lab-motif" value={motif} minLength={2} maxLength={32} pattern="[ACGTRYSWKMBDHVNUacgtryswkmbdhvnu]{2,32}"
                onChange={(e) => { setMotif(e.target.value); setResult(null); }} required spellCheck={false} />
            </label>
          ) : null}

          <div className={styles.labActions}>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? "Computing…" : "Run real analysis"}
            </button>
            <button className="button" type="button" disabled={busy} onClick={() => {
              setSequence(">my-sequence\nATGAAATAA"); setSequenceType("dna");
              setOperation("orf_scan"); setMinAa("2"); setMotif("AAA"); setResult(null); setError("");
            }}>Restore sample</button>
          </div>
          <p className={styles.labCaption}>
            Supports single-record ungapped DNA/RNA; standard genetic code 1, both strands,
            1-based inclusive coordinates. No external API, billing, AI model or database needed.
          </p>
        </form>

        <div className={styles.labOutput} aria-live="polite" aria-busy={busy}>
          <div className={styles.labTopline}><strong>02 / Scientific output</strong><span>{result ? "Computed in Codespaces" : "Ready to run"}</span></div>
          {error ? <div className={styles.labError} role="alert">{error}</div> : null}
          {!result && !error ? (
            <div className={styles.labEmpty}>
              <span className={styles.labGlyph} aria-hidden="true">⌁</span>
              <strong>{busy ? "Calculating deterministic results…" : "Your scientific results appear here"}</strong>
              <p>Choose an operation and select Run real analysis. Results will be calculated by the actual Python scientific worker library.</p>
            </div>
          ) : null}
          {result ? (
            <div className={styles.labReport}>
              <div className={styles.labResultHead}>
                <div><span className={styles.sidebarLabel}>REAL LOCAL ANALYSIS · NO SERVER PERSISTENCE</span>
                  <h3>{methods.find((method) => method.value === operation)?.label}</h3>
                </div>
                <button className="button compact" type="button" onClick={download}>Export JSON</button>
              </div>
              <div className={styles.labSummaryGrid}>
                <div><span>Input length</span><strong>{result.summary.sequence_length} nt</strong></div>
                <div><span>Sequence type</span><strong>{String(result.summary.sequence_type).toUpperCase()}</strong></div>
                <div><span>Analysis</span><strong>{operation.replaceAll("_", " ")}</strong></div>
              </div>
              {result.summary.operation === "composition_profile" &&
                Array.isArray(result.result.gc_profile) &&
                result.result.nucleotide_counts &&
                Array.isArray(result.result.codon_usage) ? (
                  <CompositionReport summary={result.summary}
                    result={result.result as CompositionResult} />
                ) : null}
              {result.result.orfs ? (
                <div className={styles.labDataSection}>
                  <h4>Complete ORFs: {result.summary.orf_count}</h4>
                  <div className={styles.labScroll}>
                    {result.result.orfs.slice(0, 60).map((orf, i) => (
                      <div className={styles.labDataRow} key={i}>
                        <strong>{orf.protein}</strong>
                        <span>{orf.start_1based}–{orf.end_1based} · {orf.strand}{orf.frame} · {orf.amino_acids} aa</span>
                      </div>
                    ))}
                    {result.result.orfs.length === 0 ? <p>No complete ORFs met the selected length threshold.</p> : null}
                  </div>
                </div>
              ) : null}
              {result.result.frames ? (
                <div className={styles.labDataSection}>
                  <h4>Six translated frames</h4>
                  <div className={styles.labScroll}>
                    {result.result.frames.map((frame) => (
                      <div className={styles.labDataRow} key={frame.strand + frame.frame}>
                        <span>{frame.strand}{frame.frame}</span>
                        <strong>{frame.protein || "—"}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {result.result.hits ? (
                <div className={styles.labDataSection}>
                  <h4>Motif occurrences: {result.summary.motif_hits}</h4>
                  <div className={styles.labScroll}>
                    {result.result.hits.slice(0, 80).map((hit, i) => (
                      <div className={styles.labDataRow} key={i}>
                        <strong>{hit.start_1based}–{hit.end_1based}</strong>
                        <span>{hit.strand} strand</span>
                      </div>
                    ))}
                    {result.result.hits.length === 0 ? <p>No motif occurrences found.</p> : null}
                  </div>
                </div>
              ) : null}
              {result.result.reverse_complement ? (
                <div className={styles.labDataSection}>
                  <h4>Reverse-complement sequence</h4>
                  <pre className={styles.labCode}>{result.result.reverse_complement}</pre>
                </div>
              ) : null}
              {result.result.truncated ? <p className={styles.labCaption}>Output limited by scientific bounds; see total counts above.</p> : null}
              <div className={styles.labHash}>
                <span>Input SHA-256 fingerprint</span>
                <code>{result.input_sha256}</code>
                <span>Engine {result.tool.id} v{result.tool.version} · local, unsigned output</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
