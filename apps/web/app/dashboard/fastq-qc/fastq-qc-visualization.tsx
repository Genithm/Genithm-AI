import { FASTQ_QC_VERSION,LENGTH_BANDS,QUALITY_BANDS,type FastqQcSummary } from "@/lib/fastq-quality-control";
import styles from "./fastq-qc.module.css";

const pct=(a:number,b:number)=>(b?100*a/b:0).toFixed(1)+"%";
const width=(a:number,m:number)=>m?Math.max(a?2:0,a/m*100).toFixed(1)+"%":"0%";
export function FastqQcVisualization({summary,hashes,saved=false}:{
  summary:FastqQcSummary;hashes:string[];saved?:boolean;
}) {
  const render=summary.reads.map((read,i)=>{
    const best=Math.max(1,...read.qualityBands);
    const lengths=Math.max(1,...read.lengthBands);
    const stride=Math.max(1,Math.ceil(read.perCycle.length/50));
    const points=read.perCycle.filter((_,j)=>j%stride===0 || j===read.perCycle.length-1);
    return (
      <article className={styles.mate} key={i}>
        <div className={styles.heading}>
          <h3>{summary.mode==="paired"?(i?"Read 2":"Read 1"):"Single-end reads"}</h3>
          <span>{read.readCount.toLocaleString()} records</span>
        </div>
        <div className={styles.metrics}>
          <div><small>Bases</small><strong>{read.baseCount.toLocaleString()}</strong></div>
          <div><small>Mean Phred</small><strong>{read.meanPhred.toFixed(2)}</strong></div>
          <div><small>Q20 bases</small><strong>{pct(read.q20BaseCount,read.baseCount)}</strong></div>
          <div><small>Q30 bases</small><strong>{pct(read.q30BaseCount,read.baseCount)}</strong></div>
          <div><small>GC excluding N</small><strong>{read.gcPercent===null?"Undefined":read.gcPercent.toFixed(1)+"%"}</strong></div>
          <div><small>Mean read length</small><strong>{read.meanLength.toFixed(1)} bp</strong></div>
        </div>
        <section className={styles.plot} aria-label="Per-cycle mean Phred quality">
          <h4>Mean Phred by sequencing cycle</h4>
          <p>Each point aggregates all reads reaching that cycle. The chart shows at most 51 points; all cycles are included in exports.</p>
          <div className={styles.cyclePlot}>
            {points.map((triple,j)=><div className={styles.cycleColumn} key={j}
              title={"Cycle "+(Math.min(j*stride,read.perCycle.length-1)+1)+": mean Q "+triple[1]}>
              <div className={styles.cycleTrack}><i style={{height:width(triple[1],45)}}/></div>
              {j===0||j===points.length-1?<small>{j===0?1:read.perCycle.length}</small>:<small aria-hidden="true">·</small>}
            </div>)}
          </div>
          <div className={styles.legend}><span>Q0</span><span>Mean quality (Q45 visual scale; higher values clipped at top)</span><span>Q45+</span></div>
        </section>
        <div className={styles.distributions}>
          <section className={styles.plot}>
            <h4>Quality-score distribution</h4>
            {QUALITY_BANDS.map((band,j)=><div className={styles.bar} key={band}>
              <span>{band}</span><div><i style={{width:width(read.qualityBands[j],best)}}/></div>
              <strong>{read.qualityBands[j].toLocaleString()}</strong>
            </div>)}
          </section>
          <section className={styles.plot}>
            <h4>Read length distribution</h4>
            {LENGTH_BANDS.map((band,j)=><div className={styles.bar} key={band}>
              <span>{band}</span><div><i style={{width:width(read.lengthBands[j],lengths)}}/></div>
              <strong>{read.lengthBands[j].toLocaleString()}</strong>
            </div>)}
          </section>
        </div>
        <div className={styles.baseStrip}>
          {(["A","C","G","T","N"] as const).map(base=><span key={base}>{base}: {read.baseCounts[base].toLocaleString()}</span>)}
        </div>
      </article>
    );
  });
  return <section className={styles.visualization}>
    <div className={styles.resultHeading}>
      <h2>{saved?"Saved FASTQ QC aggregates":"Calculated FASTQ quality control"}</h2>
      <span className={styles.accent}>{summary.mode==="paired"?"Paired-end · mate names checked":"Single-end"} · Phred+33</span>
    </div>
    {render}
    <aside className={styles.boundaries}>
      <strong>Scientific limits and provenance</strong>
      <p>This report uses <code>{FASTQ_QC_VERSION}</code>. Phred+33 encoding is assumed, not detected. Q20 and Q30 are proportions of sequenced bases, not proportions of reads. GC excludes N bases. Quality scores do not independently establish read alignment, species assignment or sequencing accuracy.</p>
      <p>{summary.mode==="paired"?"R1/R2 read counts, read identifiers and mate orientation were checked in original order. Reads have not been aligned or merged.":"Single-end reads were analyzed without mate matching."}</p>
      <p>{saved?"Saved metrics originate from the browser and remain unverified by the server.":"Raw FASTQ sequences and read IDs remain in this browser; only explicitly saved aggregates go to Supabase."}</p>
      {hashes.map((hash,i)=><p key={hash}>
        <strong>Browser-computed {summary.mode==="paired"?(i?"R2":"R1"):"read-file"} SHA-256:</strong> <code>{hash}</code>
      </p>)}
      <p>Source fingerprints are <strong>not independently server-verified</strong>. This is read-level exploratory QC, not differential gene expression, variant calling, RNA alignment or clinical interpretation.</p>
    </aside>
  </section>;
}
