"use client";
import {useEffect,useRef,useState} from "react";

type Source={id:string;original_filename:string;state:string;data_format:string};
type Pair={id:string;title:string;state:string;expected_bytes:number;checked_bytes:number;checked_pairs:number;
 sources_available?:boolean;error_code:string|null;summary?:{pair_count:number;explicit_mate_labels:number;
 partially_labeled_pairs:number;unlabeled_pairs:number;identical_source_hashes:boolean;
 source_sha256:string[];mates:{read_count:number;base_count:number;mean_phred:number;q30_bases:number}[]}|null};
type Overview={worker_ready:boolean;pairs:Pair[]};
type Call=<T>(path:string,body?:unknown)=>Promise<T>;
const size=(n:number)=>(n/1024**3).toFixed(2)+" GiB";

function PairControls({project,sources,call}:{project:string;sources:Source[];call:Call}){
 const [overview,setOverview]=useState<Overview|null>(null),[r1,setR1]=useState(""),[r2,setR2]=useState(""),[title,setTitle]=useState("");
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const request=useRef<string|null>(null);const mounted=useRef(true);
 const eligible=sources.filter(s=>s.state==="ready"&&["fastq","fastq.gz"].includes(s.data_format));
 async function refresh(){const next=await call<Overview>("/projects/"+project+"/pairs");if(mounted.current)setOverview(next);}
 useEffect(()=>{mounted.current=true;void refresh().catch(e=>{if(mounted.current)setError(e.message);});return()=>{mounted.current=false;};
 // The controls mount only after the researcher opens this disclosure.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function run(){if(busy)return;setBusy(true);setError("");try{
  request.current??=crypto.randomUUID();
  await call<Pair>("/pairs",{project_id:project,request_id:request.current,r1_id:r1,r2_id:r2,title:title.trim()});
  if(mounted.current){request.current=null;await refresh();}
 }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Request uncertain. Refresh status before retrying.");}
 finally{if(mounted.current)setBusy(false);}}
 async function cancel(id:string){setBusy(true);setError("");try{await call("/pairs/"+id+"/cancel",{});await refresh();}
 catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Cancellation not confirmed.");}finally{if(mounted.current)setBusy(false);}}
 return <section aria-label="Server-side paired FASTQ validation">
  <h3>Check complete R1 / R2 pairs</h3>
  <p>Select two server-verified FASTQ uploads from this project. Genithm rereads both complete files, verifies both checksums, and compares every record's identifier in order. Reads are not aligned or merged.</p>
  <p className="genithm-note">Pair verifier: {overview?(overview.worker_ready?"available":"offline"):"not yet confirmed"}. This requires separately enabled paired-read processing; local QC and existing uploads are unchanged.</p>
  <label>Study label <input value={title} maxLength={160} disabled={busy} onChange={e=>{setTitle(e.target.value);request.current=null;}} placeholder="Paired sequencing input"/></label>
  <div className="genithm-page-links">
   <label>R1 upload <select value={r1} disabled={busy} onChange={e=>{setR1(e.target.value);request.current=null;}}>
    <option value="">Choose R1</option>{eligible.map(s=><option key={s.id} value={s.id}>{s.original_filename} ({s.id.slice(0,8)})</option>)}</select></label>
   <label>R2 upload <select value={r2} disabled={busy} onChange={e=>{setR2(e.target.value);request.current=null;}}>
    <option value="">Choose R2</option>{eligible.map(s=><option key={s.id} value={s.id}>{s.original_filename} ({s.id.slice(0,8)})</option>)}</select></label>
  </div>
  <div className="genithm-page-links">
   <button type="button" className="button primary" disabled={busy||!overview?.worker_ready||!r1||!r2||r1===r2||title.trim().length<3||!eligible.some(s=>s.id===r1)||!eligible.some(s=>s.id===r2)} onClick={()=>void run()}>Validate full pair</button>
   <button type="button" className="button" disabled={busy} onClick={()=>{setError("");void refresh().catch(e=>setError(e.message));}}>Refresh pair status</button>
  </div>
  {error&&<p role="alert" className="error">{error}</p>}
  {overview&&!overview.pairs.length&&<p className="genithm-note">No recorded paired validations for this project.</p>}
  {overview?.pairs.map(job=><article className="genithm-disclosure" key={job.id}>
   <h4>{job.title}</h4><p>{job.state.replaceAll("_"," ")} {job.error_code?"- "+job.error_code.replaceAll("_"," "):""}</p>
   {job.state==="verifying"&&<p role="status">Read {size(job.checked_bytes)} of {size(job.expected_bytes)}; {job.checked_pairs.toLocaleString()} pairs compared in this attempt.</p>}
   {["queued","verifying"].includes(job.state)&&<button type="button" className="button" disabled={busy} onClick={()=>void cancel(job.id)}>Cancel pair validation</button>}
   {job.state==="ready"&&job.summary&&<>
    <p><strong>{job.summary.pair_count.toLocaleString()} ordered pairs checked</strong>, with both complete source checksums verified. No sampling.</p>
    <p>{job.summary.explicit_mate_labels.toLocaleString()} pairs with explicit R1/R2 labels; {job.summary.partially_labeled_pairs.toLocaleString()} partially labeled; {job.summary.unlabeled_pairs.toLocaleString()} unlabeled. Matching identifiers do not prove biological pairing or identifier uniqueness.</p>
    {job.summary.identical_source_hashes&&<p className="genithm-note">The two source files have identical bytes. Confirm the intended R1/R2 inputs independently.</p>}
    {job.sources_available===false&&<p className="genithm-note">One or both source records are no longer ready. This is a historical validation, not a currently reusable input pair.</p>}
    <details><summary>Verified per-mate evidence</summary>{job.summary.mates.map((m,i)=><p key={i}>R{i+1}: {m.read_count.toLocaleString()} reads; {m.base_count.toLocaleString()} bases; mean Phred {m.mean_phred.toFixed(2)}; Q30 bases {m.q30_bases.toLocaleString()}. SHA-256: <code>{job.summary!.source_sha256[i]}</code></p>)}</details>
   </>}
  </article>)}
 </section>;
}

export function LargePairPanel(props:{project:string;sources:Source[];call:Call}){
 const [open,setOpen]=useState(false);
 return <details className="genithm-disclosure" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>Paired-end verification for large FASTQ files</summary>
  {open?<PairControls key={props.project} {...props}/>:null}
 </details>;
}
