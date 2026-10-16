import {
  QUALITY_LABELS, VARIANT_CATEGORIES,
  type VcfPreview, type VcfQcSummary,
} from "@/lib/vcf-quality-control";
import styles from "./variant-qc.module.css";

function pct(n:number, total:number):string {
  return total ? (100*n/total).toFixed(1)+"%" : "0%";
}
function barHeight(value:number, max:number):string {
  return (max ? Math.max(2,Math.round(100*value/max)) : 0)+"%";
}
export function VariantQcSummary({
  summary, preview=[], sourceSha256, saved=false,
}: {
  summary:VcfQcSummary;
  preview?:VcfPreview[];
  sourceSha256:string;
  saved?:boolean;
}) {
  const maxType=Math.max(1,...VARIANT_CATEGORIES.map(t=>summary.variantCounts[t]));
  const maxChrom=Math.max(1,...summary.chromCounts.map(x=>x.count));
  const maxQuality=Math.max(1,...summary.qualityBins);
  const titv=summary.transversions
    ? (summary.transitions/summary.transversions).toFixed(3) : "Undefined";
  return (
    <section className={styles.results} aria-label="Computed VCF quality-control results">
      <div className={styles.resultsHeading}>
        <div><span className={styles.eyebrow}>DESCRIPTIVE VARIANT QUALITY CONTROL</span>
          <h2>{saved ? "Saved QC summary" : "Computed QC results"}</h2></div>
        <span className={styles.localBadge}>{saved?"Stored aggregate only":"Processed in this browser"}</span>
      </div>
      <div className={styles.statGrid}>
        <article><small>Variant records</small><strong>{summary.totalRecords.toLocaleString()}</strong></article>
        <article><small>PASS records</small><strong>{pct(summary.filterCounts.pass,summary.totalRecords)}</strong></article>
        <article><small>Ti/Tv · eligible SNVs</small><strong>{titv}</strong></article>
        <article><small>Contigs</small><strong>{summary.distinctChromosomes}</strong></article>
        <article><small>Sample columns</small><strong>{summary.sampleColumns}</strong></article>
      </div>
      <div className={styles.chartGrid}>
        <section className={styles.chartCard} aria-label="Variant categories">
          <h3>Variant classification</h3>
          <p>Record-level categories are mutually exclusive. Multiallelic calls are counted as one record.</p>
          {VARIANT_CATEGORIES.map(category=>(
            <div className={styles.horizontalRow} key={category}>
              <span>{category}</span>
              <div className={styles.horizontalTrack}><i style={{width:barHeight(summary.variantCounts[category],maxType)}}/></div>
              <strong>{summary.variantCounts[category].toLocaleString()}</strong>
            </div>
          ))}
        </section>
        <section className={styles.chartCard} aria-label="FILTER calls">
          <h3>FILTER outcomes</h3>
          <p>A missing “.” FILTER is not equivalent to PASS.</p>
          {(["pass","filtered","missing"] as const).map(label=>(
            <div className={styles.horizontalRow} key={label}>
              <span>{label==="pass"?"PASS":label==="filtered"?"Filtered":"Missing (.)"}</span>
              <div className={styles.horizontalTrack}><i style={{
                width:pct(summary.filterCounts[label],summary.totalRecords)}}/></div>
              <strong>{summary.filterCounts[label].toLocaleString()}</strong>
            </div>
          ))}
        </section>
        <section className={styles.chartCard} aria-label="QUAL histogram">
          <h3>Variant QUAL histogram</h3>
          <p>Scores are reported as provided in VCF; QUAL is not a probability of clinical validity.</p>
          <div className={styles.histogram}>
            {QUALITY_LABELS.map((label,i)=>(
              <div key={label} className={styles.histBar}>
                <strong>{summary.qualityBins[i]}</strong>
                <div className={styles.histTrack}><i style={{
                  height:barHeight(summary.qualityBins[i],maxQuality)}} /></div>
                <small>{label}</small>
              </div>
            ))}
          </div>
          <p>Missing QUAL: {summary.missingQual.toLocaleString()} records.</p>
        </section>
        <section className={styles.chartCard} aria-label="Top chromosome record counts">
          <h3>Chromosome / contig coverage</h3>
          <p>Top 12 contigs by record count (not sequencing depth).</p>
          {summary.chromCounts.map(item=>(
            <div className={styles.horizontalRow} key={item.chrom}>
              <span title={item.chrom}>{item.chrom}</span>
              <div className={styles.horizontalTrack}><i style={{width:barHeight(item.count,maxChrom)}}/></div>
              <strong>{item.count.toLocaleString()}</strong>
            </div>
          ))}
        </section>
      </div>
      <div className={styles.method}>
        <strong>Scientific interpretation boundaries</strong>
        <p>Ti/Tv uses only canonical, biallelic SNV substitutions; ambiguous or identical bases are excluded. There are {summary.transitions} transitions and {summary.transversions} transversions. This is exploratory VCF QC, not read QC, variant calling, pathogenicity assessment, or clinical interpretation. No genotype values are analyzed.</p>
        <p><strong>Browser-computed source SHA-256:</strong> <code>{sourceSha256}</code></p>
        <p>Source hash and metrics are computed locally and are <strong>not independently verified by the server</strong>. Saved snapshots contain aggregate numbers only; Genithm does not upload or retain the original VCF here.</p>
      </div>
      {preview.length ? (
        <details className={styles.preview}>
          <summary>Preview first {preview.length} variant records (only on this device)</summary>
          <div className={styles.tableScroll}>
            <table>
              <thead><tr><th>Contig</th><th>Position</th><th>REF</th><th>ALT</th><th>QUAL</th><th>FILTER</th><th>Type</th></tr></thead>
              <tbody>{preview.map((row,i)=>(
                <tr key={i}><td>{row.chrom}</td><td>{row.pos}</td>
                  <td>{row.ref}</td><td>{row.alt}</td><td>{row.qual ?? "."}</td>
                  <td>{row.filter}</td><td>{row.category}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
