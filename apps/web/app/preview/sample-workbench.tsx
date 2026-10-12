"use client";

import { useState } from "react";

import styles from "./preview.module.css";

type Method = "orf" | "translation" | "motif" | "complement";

const methods: { id: Method; name: string; label: string }[] = [
  { id: "orf", name: "ORF discovery", label: "01" },
  { id: "translation", name: "Six-frame translation", label: "02" },
  { id: "motif", name: "IUPAC motif scan", label: "03" },
  { id: "complement", name: "Reverse complement", label: "04" },
];

const results: Record<Method, {
  title: string;
  summary: string;
  value: string;
  valueLabel: string;
  detail: string;
  coordinates: string;
  output: string;
  note: string;
}> = {
  orf: {
    title: "Complete open reading frame",
    summary: "Start codon ATG followed by an in-frame stop in the +1 reading frame.",
    value: "MK",
    valueLabel: "Translated peptide",
    detail: "1 complete ORF · start ATG · stop TAA",
    coordinates: "1–9 (+ strand)",
    output: "M K",
    note: "Minimum size set to 2 amino acids; stop codon excluded from peptide.",
  },
  translation: {
    title: "Standard genetic-code translation",
    summary: "Three forward and three reverse reading frames evaluated under NCBI table 1.",
    value: "MK*",
    valueLabel: "Forward frame +1",
    detail: "6 frames · standard genetic code",
    coordinates: "+1 reading frame",
    output: "M K *",
    note: "Asterisk represents a stop codon. The other five frames are included in the real JSON artifact.",
  },
  motif: {
    title: "Overlapping motif detection",
    summary: "IUPAC pattern AAA scanned across both nucleotide strands.",
    value: "1 hit",
    valueLabel: "Motif count",
    detail: "Motif: AAA · 1 total occurrence",
    coordinates: "4–6 (+ strand)",
    output: "A A A",
    note: "Motif scans include reverse-strand matches and use 1-based inclusive coordinates.",
  },
  complement: {
    title: "Reverse-complement sequence",
    summary: "Reverse the input DNA and complement each nucleotide to preserve strand orientation.",
    value: "9 nt",
    valueLabel: "Output length",
    detail: "DNA · 9 nucleotides",
    coordinates: "Reverse orientation",
    output: "T T A T T T C A T",
    note: "Verified reverse complement of ATGAAATAA is TTATTTCAT.",
  },
};

export function SampleWorkbench() {
  const [method, setMethod] = useState<Method>("orf");
  const current = results[method];

  return (
    <div className={styles.workbench}>
      <aside className={styles.workbenchSidebar}>
        <div className={styles.sidebarLabel}>ANALYSIS LIBRARY</div>
        <div className={styles.methodList} role="tablist" aria-label="Example sequence analyses">
          {methods.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={"preview-tab-" + entry.id}
              aria-selected={method === entry.id}
              aria-controls="preview-result-panel"
              className={method === entry.id ? styles.selectedMethod : styles.method}
              onClick={() => setMethod(entry.id)}
            >
              <span>{entry.label}</span>
              <strong>{entry.name}</strong>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>

        <div className={styles.sampleSidebar}>
          <div className={styles.sidebarLabel}>INPUT / SINGLE FASTA</div>
          <code>&gt;codespaces-demo</code>
          <code>ATGAAATAA</code>
          <p>DNA · 9 bases · ungapped, local sample</p>
        </div>
      </aside>

      <section
        role="tabpanel"
        id="preview-result-panel"
        aria-labelledby={"preview-tab-" + method}
        className={styles.resultPanel}
      >
        <div className={styles.resultHeader}>
          <div>
            <div className={styles.sidebarLabel}>VERIFIED REFERENCE FIXTURE · NO JOB SUBMITTED</div>
            <h3>{current.title}</h3>
            <p>{current.summary}</p>
          </div>
          <span className={styles.resultTag}>SAMPLE RESULT</span>
        </div>

        <div className={styles.metrics}>
          <div className={styles.primaryMetric}>
            <span>{current.valueLabel}</span>
            <strong>{current.value}</strong>
          </div>
          <div className={styles.secondaryMetric}>
            <span>Coordinate / orientation</span>
            <strong>{current.coordinates}</strong>
          </div>
        </div>

        <div className={styles.sequencePreview}>
          <div className={styles.sequenceLabel}>
            <span>ANALYSIS OUTPUT</span>
            <span>STANDARD GENETIC CODE</span>
          </div>
          <div className={styles.sequenceValue}>{current.output}</div>
          <div className={styles.miniFooter}>{current.detail}</div>
        </div>
        <p className={styles.methodNote}>{current.note}</p>

        <div className={styles.provenance}>
          <div>
            <span>Compute engine</span>
            <strong>Genithm scientific-worker</strong>
          </div>
          <div>
            <span>Output policy</span>
            <strong>Deterministic · bounded</strong>
          </div>
          <div>
            <span>Evidence in real runs</span>
            <strong>SHA-256 + provenance JSON</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
