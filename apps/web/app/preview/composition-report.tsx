"use client";

import styles from "./preview.module.css";

export type CompositionResult = {
  nucleotide_counts: Record<string, number>;
  gc_profile: { start_1based: number; end_1based: number; gc_percent: number | null; known_bases: number }[];
  cpg_count: number;
  cpg_observed_expected: number | null;
  codon_usage: { codon: string; count: number; amino_acid: string }[];
  ambiguous_codons: number;
  trailing_bases_excluded_from_codon_usage: number;
  top_trinucleotides: { kmer: string; count: number }[];
  methods: Record<string, string>;
};

type Props = {
  summary: Record<string, string | number | null>;
  result: CompositionResult;
};

function metric(number: unknown, suffix = "") {
  return typeof number === "number" ? `${number}${suffix}` : "N/A";
}

function GCChart({ points }: { points: CompositionResult["gc_profile"] }) {
  const width = 620;
  const height = 168;
  const margin = { left: 32, right: 10, top: 12, bottom: 30 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const maximumPosition = Math.max(...points.map(p => p.end_1based), 1);
  const x = (point: (typeof points)[number]) =>
    margin.left + ((point.start_1based + point.end_1based) / 2 / maximumPosition) * plotW;
  const y = (pct: number) => margin.top + plotH * (1 - pct / 100);

  const segments: string[] = [];
  let continuous: string[] = [];
  for (const item of points) {
    if (item.gc_percent === null) {
      if (continuous.length > 1) segments.push(continuous.join(" "));
      continuous = [];
    } else {
      continuous.push(`${x(item)},${y(item.gc_percent)}`);
    }
  }
  if (continuous.length > 1) segments.push(continuous.join(" "));

  return (
    <div className={styles.gcChart}>
      <svg role="img" aria-label="Sliding window GC percentage from 0 to 100 percent along the sequence"
        viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {[0, 25, 50, 75, 100].map(tick => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)}
              stroke="currentColor" strokeOpacity={0.13} strokeDasharray="4 5" />
            <text x={margin.left - 8} y={y(tick) + 4} textAnchor="end" fill="currentColor" fontSize="11">{tick}</text>
          </g>
        ))}
        {segments.map((line, i) => (
          <polyline key={i} points={line} fill="none" stroke="#82e4c9"
            strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {points.filter(p => p.gc_percent !== null).map((p, i) => (
          <circle key={i} cx={x(p)} cy={y(p.gc_percent!)} r={points.length > 28 ? 1.6 : 3.2}
            fill="#a1f2d9">
            <title>{`Bases ${p.start_1based}–${p.end_1based}: ${p.gc_percent}% GC (${p.known_bases} known)`}</title>
          </circle>
        ))}
        <text x={margin.left} y={height - 5} fill="currentColor" fontSize="11">1</text>
        <text x={width - margin.right} y={height - 5} fill="currentColor" fontSize="11" textAnchor="end">
          {maximumPosition} bases
        </text>
      </svg>
      <p className={styles.labCaption}>
        GC content per window (excluding N); 100-base windows with 50% overlap for long sequences.
        Gaps indicate windows containing only unknown bases.
      </p>
    </div>
  );
}

export function CompositionReport({ summary, result }: Props) {
  const maxKmer = Math.max(...result.top_trinucleotides.map(x => x.count), 1);
  return (
    <div className={styles.compositionReport}>
      <div className={styles.compositionStatGrid}>
        <div><span>GC content</span><strong>{metric(summary.gc_percent, "%")}</strong></div>
        <div><span>AT content</span><strong>{metric(summary.at_percent, "%")}</strong></div>
        <div><span>Unknown N</span><strong>{metric(summary.n_percent, "%")}</strong></div>
        <div><span>Entropy</span><strong>{metric(summary.shannon_entropy_bits, " bits")}</strong></div>
        <div><span>CpG sites</span><strong>{metric(summary.cpg_count)}</strong></div>
        <div><span>CpG O/E</span><strong>{metric(summary.cpg_observed_expected)}</strong></div>
      </div>

      <section className={styles.labDataSection}>
        <h4>Nucleotide composition</h4>
        <div className={styles.baseCounts}>
          {Object.entries(result.nucleotide_counts).map(([base, count]) => (
            <div key={base}><span>{base}</span><strong>{count.toLocaleString()}</strong></div>
          ))}
        </div>
      </section>

      <section className={styles.labDataSection}>
        <h4>Sliding-window GC profile ({summary.gc_window_count} windows)</h4>
        <GCChart points={result.gc_profile} />
      </section>

      <section className={styles.labDataSection}>
        <h4>Most frequent overlapping 3-mers</h4>
        {result.top_trinucleotides.length ? (
          <div className={styles.kmerList}>
            {result.top_trinucleotides.map(item => (
              <div className={styles.kmerRow} key={item.kmer}>
                <code>{item.kmer}</code>
                <div className={styles.kmerTrack}>
                  <div style={{ width: `${100 * item.count / maxKmer}%` }} />
                </div>
                <span>{item.count}</span>
              </div>
            ))}
          </div>
        ) : <p className={styles.labCaption}>No unambiguous trinucleotides available.</p>}
      </section>

      <section className={styles.labDataSection}>
        <h4>Codon usage — forward +1 frame</h4>
        <div className={styles.codonGrid}>
          {result.codon_usage.map(codon => (
            <div key={codon.codon}><code>{codon.codon}</code><strong>{codon.amino_acid}</strong><span>×{codon.count}</span></div>
          ))}
          {!result.codon_usage.length ? <p className={styles.labCaption}>No unambiguous codons.</p> : null}
        </div>
        <p className={styles.labCaption}>
          {result.ambiguous_codons} ambiguous codons and {result.trailing_bases_excluded_from_codon_usage} trailing bases
          excluded from codon frequencies. Stop codons use *.
        </p>
      </section>
      <p className={styles.labCaption}>
        Exploratory composition only. CpG observed/expected is descriptive; no CpG islands, genes,
        pathogenic variants or clinical interpretations are inferred. Percentage values exclude N bases.
      </p>
    </div>
  );
}
