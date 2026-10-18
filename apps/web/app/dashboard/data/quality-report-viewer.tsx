"use client";
import {useEffect, useId, useState} from "react";
import styles from "./quality-report.module.css";

type Profile = {
 schema: "genithm-read-quality-profile/1"; engine_version: string; positions: number[][];
 read_lengths: number[][]; read_mean_phred_counts: number[]; read_gc_percent_counts: number[]; undefined_gc_reads: number;
};
type Metric = {read_count:number; base_count:number; mean_phred:number; q30_bases:number; quality_profile:Profile};
type Report = {report_sha256:string; source_sha256:string|string[]; metrics?:Metric; mates?:Metric[]};
export type QualityEnvelope = {schema:"genithm-quality-report-envelope/1"; record_id:string; project_id:string; sources_available:boolean; report:Report};
export type QualityCall = <T>(path:string, body?:unknown)=>Promise<T>;
export type QualityDownload = (path:string, format:"json"|"tsv")=>Promise<void>;
const percent = (n:number,d:number)=>d>0?(100*n/d).toFixed(2)+"%":"Not defined";
const range = (row:number[])=>row[0]===row[1]?String(row[0]):`${row[0]}-${row[1]}`;
const number = (n:number)=>n.toLocaleString();

function ProfileChart({profile, view}:{profile:Profile;view:string}){
 const id=useId();const rows=profile.positions;const width=760, height=190, left=48, top=18;
 const quality=view==="quality";
 const data = view==="length"?profile.read_lengths.map(row=>({label:range(row),count:row[2]})):
  (view==="read-quality"?profile.read_mean_phred_counts:profile.read_gc_percent_counts).map((count,i)=>({label:String(i),count}));
 const ceiling=quality?Math.min(93,Math.max(45,Math.ceil(Math.max(...rows.flatMap(r=>[r[15],r[3]/r[2]]))/10)*10)):Math.max(1,...data.map(x=>x.count));
 const x=(i:number,n:number)=>left+width*(i+.5)/n;
 const y=(value:number)=>top+height*(1-value/ceiling);
 const title=quality?"Base quality along the read":view==="length"?"Read-length distribution":view==="read-quality"?"Distribution of mean read quality":"Per-read GC distribution";
 const ticks=quality?[0,Math.round(ceiling/2),ceiling]:[0,Math.ceil(ceiling/2),ceiling];
 return <figure className={styles.figure}>
  <svg viewBox="0 0 840 266" role="img" aria-labelledby={id+"-title "+id+"-description"}>
   <title id={id+"-title"}>{title}</title>
   <desc id={id+"-description"}>{quality?"Mean Phred score with the 25th to 75th percentile band. Each displayed range pools all observed bases; ranges are equally spaced, not drawn to scale.":"Counts include every validated read. The exact values are available in the data table below."}</desc>
   {ticks.map((tick,i)=><g key={i}><line x1={left} x2={left+width} y1={y(tick)} y2={y(tick)} className={styles.grid}/><text x={left-8} y={y(tick)+4} textAnchor="end">{tick>=1000000?(tick/1000000).toFixed(1)+"M":tick>=1000?(tick/1000).toFixed(1)+"k":tick}</text></g>)}
   {quality?<>
    <polygon className={styles.band} points={[...rows.map((r,i)=>`${x(i,rows.length)},${y(r[12])}`),...rows.map((r,i)=>`${x(i,rows.length)},${y(r[14])}`).reverse()].join(" ")}/>
    <polyline className={styles.mean} points={rows.map((r,i)=>`${x(i,rows.length)},${y(r[3]/r[2])}`).join(" ")}/>
    {rows.map((r,i)=><circle key={r[0]} cx={x(i,rows.length)} cy={y(r[3]/r[2])} r={3}><title>Position {range(r)}: mean {(r[3]/r[2]).toFixed(2)}, median {r[13]}, {number(r[2])} observed bases</title></circle>)}
    <text x={left} y={235}>{range(rows[0])}</text><text x={left+width} y={235} textAnchor="end">{range(rows[rows.length-1])}</text>
   </>:<>
    {data.map((d,i)=><rect key={i} x={left+width*i/data.length+1} width={Math.max(1,width/data.length-2)} y={y(d.count)} height={height*d.count/ceiling}><title>{d.label}: {number(d.count)} reads</title></rect>)}
    <text x={left} y={235}>{data[0].label}</text><text x={left+width} y={235} textAnchor="end">{data[data.length-1].label}</text>
   </>}
   <text x={left+width/2} y={257} textAnchor="middle">{quality?"Position ranges (equal-width display; not to scale)":view==="length"?"Read-length ranges (bases; not to scale)":view==="read-quality"?"Mean Phred score, rounded down":"GC percentage over A/C/G/T, rounded down"}</text>
  </svg>
  <figcaption>{quality?"Line: mean Phred. Shaded band: 25th-75th percentiles of all observed bases in each range. Values for individual positions within a range are not retained.":"Every read contributes once. Counts are exact within the stated bins."}</figcaption>
 </figure>;
}

function MetricView({metric, label, hash}:{metric:Metric;label:string;hash:string}){
 const [view,setView]=useState("quality");const p=metric.quality_profile;
 return <article className={styles.mate} aria-label={label+" quality profile"}>
  <div className={styles.heading}><h4>{label}</h4><span>All reads included</span></div>
  <dl className={styles.metrics}>
   <div><dt>Reads</dt><dd>{number(metric.read_count)}</dd></div><div><dt>Bases</dt><dd>{number(metric.base_count)}</dd></div>
   <div><dt>Mean Phred</dt><dd>{metric.mean_phred.toFixed(2)}</dd></div><div><dt>Q30 bases</dt><dd>{percent(metric.q30_bases,metric.base_count)}</dd></div>
  </dl>
  <label className={styles.select}>Profile view <select value={view} onChange={e=>setView(e.target.value)}>
   <option value="quality">Base quality by position range</option><option value="length">Read lengths</option>
   <option value="read-quality">Mean read quality</option><option value="gc">Read GC content</option>
  </select></label>
  <ProfileChart profile={p} view={view}/>
  {view==="gc"&&<p>{number(p.undefined_gc_reads)} all-N reads have undefined GC content and are excluded from this histogram, not from the total read count.</p>}
  <details><summary>Exact profile data</summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label={label+" profile data table"}>
   {view==="quality"?<table><caption>{label}: pooled base-quality statistics, Phred+33 assumed</caption><thead><tr>{["Position","Bases","Mean","P10","P25","Median","P75","P90","Q20","Q30","N"].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead><tbody>
    {p.positions.map(r=><tr key={r[0]}><th scope="row">{range(r)}</th><td>{number(r[2])}</td><td>{(r[3]/r[2]).toFixed(2)}</td>{r.slice(11,16).map((v,i)=><td key={i}>{v}</td>)}<td>{percent(r[4],r[2])}</td><td>{percent(r[5],r[2])}</td><td>{percent(r[10],r[2])}</td></tr>)}
   </tbody></table>:<table><caption>{label}: {view==="length"?"read lengths":view==="read-quality"?"mean read quality (rounded down)":"GC percentage (N excluded; rounded down)"}</caption><thead><tr><th scope="col">{view==="length"?"Length range":view==="read-quality"?"Mean Phred bin":"GC percent bin"}</th><th scope="col">Reads</th></tr></thead><tbody>
    {view==="length"?p.read_lengths.map(r=><tr key={r[0]}><th scope="row">{range(r)}</th><td>{number(r[2])}</td></tr>):(view==="read-quality"?p.read_mean_phred_counts:p.read_gc_percent_counts).map((count,i)=>count>0?<tr key={i}><th scope="row">{i}</th><td>{number(count)}</td></tr>:null)}
   </tbody></table>}
  </div></details>
  <p className={styles.hash}>Source SHA-256 <code>{hash}</code></p>
 </article>;
}

export function QualityReportView({envelope}:{envelope:QualityEnvelope}){
 const report=envelope.report;const metrics=report.mates||[report.metrics!];
 const hashes=Array.isArray(report.source_sha256)?report.source_sha256:[report.source_sha256];
 return <div className={styles.report}>
  <p>Complete-file profiles from the verification worker, not AI-generated values. Phred+33 is assumed, not auto-detected. Ranges are fixed and pool all observed bases; variable-length reads contribute only where a base exists.</p>
  <p className="genithm-note">These descriptive profiles do not perform trimming, adapter detection, alignment, or FastQC pass/fail classification.</p>
  {envelope.sources_available===false&&<p role="note">Historical result: one or both sources are no longer ready. This report does not authorize reuse of those inputs.</p>}
  {metrics.map((m,i)=><MetricView key={i} metric={m} label={report.mates?`R${i+1}`:"Single file"} hash={hashes[i]}/>)}
  <p className={styles.hash}>Report SHA-256 <code>{report.report_sha256}</code></p>
  <p className="genithm-note">The server checked this report's checksum and aggregate consistency before returning it. The checksum detects accidental changes; it is not a digital signature or independent scientific validation.</p>
 </div>;
}

function LoadedReport({path,call,download}:{path:string;call:QualityCall;download:QualityDownload}){
 const [envelope,setEnvelope]=useState<QualityEnvelope|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setEnvelope(null);setError("");setLoading(true);
  void call<QualityEnvelope>(path).then(value=>{if(active){
   if(value.schema!=="genithm-quality-report-envelope/1")throw new Error("Unsupported quality report format.");
   setEnvelope(value);
  }}).catch(e=>{if(active)setError(e instanceof Error?e.message:"The quality report could not be loaded.");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 // Parent remounts this component when project/record identity changes; call is not a subscription.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[path,attempt]);
 async function save(format:"json"|"tsv"){setBusy(true);setError("");try{await download(path,format);}catch(e){setError(e instanceof Error?e.message:"Report export failed.");}finally{setBusy(false);}}
 return <section aria-label="Detailed read-quality report" aria-busy={loading}>
  {loading&&<p role="status">Loading the verified report...</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {!loading&&!envelope&&<button className="button" type="button" onClick={()=>setAttempt(a=>a+1)}>Retry report</button>}
  {envelope&&<><div className="genithm-page-links"><button className="button" type="button" disabled={busy} onClick={()=>void save("json")}>Download full JSON report</button><button className="button" type="button" disabled={busy} onClick={()=>void save("tsv")}>Download profile TSV</button></div><QualityReportView envelope={envelope}/></>}
 </section>;
}

export function QualityReportViewer(props:{path:string;call:QualityCall;download:QualityDownload}){
 const [open,setOpen]=useState(false);
 return <details className="genithm-disclosure" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>Explore read-quality profiles</summary>
  {open?<LoadedReport key={props.path} {...props}/>:null}
 </details>;
}
