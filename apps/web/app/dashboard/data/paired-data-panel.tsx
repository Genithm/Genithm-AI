"use client";
import {useEffect,useId,useMemo,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";

type Input={id:string;original_filename:string;state:string;data_format:string;expected_bytes:number};
type Metrics={read_count:number;base_count:number;mean_phred:number;q20_bases:number;q30_bases:number;gc_percent:number|null};
type Result={matched_pairs:number;both_mate_annotations_checked:number;identifier_order_only_pairs:number;
 identical_source_bytes:boolean;r1:{sha256:string;metrics:Metrics};r2:{sha256:string;metrics:Metrics}};
type Job={id:string;title:string;state:string;read1_id:string;read2_id:string;read1_bytes:number;read2_bytes:number;
 checked_read1_bytes:number;checked_read2_bytes:number;error_code:string|null;result?:Result;result_sha256?:string};
const base=(process.env.NEXT_PUBLIC_GENITHM_API_URL||"").replace(/\/$/,"");
const bytes=(n:number)=>(n/1024**3).toFixed(2)+" GiB";
const explanations:Record<string,string>={paired_data_not_enabled:"Server-side paired checking has not been enabled.",
 pair_worker_not_ready:"The paired-read worker is offline. No job was started.",pair_sources_unavailable:"Select two completed FASTQ uploads that you own in this project.",
 pair_capacity_exceeded:"The project already has active checks or has reached the hourly submission limit.",
 source_in_active_pair:"Cancel the active paired-read check before removing its source files.",
 pair_count_mismatch:"R1 and R2 contain different numbers of records. No paired result was published.",
 pair_identifier_mismatch:"The ordered R1/R2 read identifiers do not correspond. No paired result was published.",
 mate_orientation_mismatch:"Read annotations conflict with the selected R1/R2 orientation.",
 source_changed:"A source no longer matches the verified input. No paired result was published."};

export function PairedDataDisclosure({project,uploads}:{project:string;uploads:Input[]}){
 const [open,setOpen]=useState(false);
 return <details className="genithm-disclosure" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>Check paired-end data (R1 + R2)</summary>
  {open&&<PairedDataPanel key={project} project={project} uploads={uploads}/>}
 </details>;
}

function PairedDataPanel({project,uploads}:{project:string;uploads:Input[]}){
 const db=useMemo(()=>createClient(),[]);const id=useId();
 const available=uploads.filter(x=>x.state==="ready"&&(x.data_format==="fastq"||x.data_format==="fastq.gz"));
 const [r1,setR1]=useState("");const [r2,setR2]=useState("");const [title,setTitle]=useState("Paired FASTQ check");
 const [ready,setReady]=useState(false);const [jobs,setJobs]=useState<Job[]>([]);const [selected,setSelected]=useState<Job|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const requestId=useRef<string|null>(null);
 async function response(path:string,body?:unknown){
  if(!base)throw new Error("The private large-data API has not been configured.");
  const {data,error:authError}=await db.auth.getSession();const token=data.session?.access_token;
  if(authError||!token)throw new Error("Sign in again before starting paired analysis.");
  const res=await fetch(base+"/api/v1/large-data/pairs"+path,{method:body===undefined?"GET":"POST",cache:"no-store",
   headers:{Authorization:"Bearer "+token,...(body!==undefined?{"Content-Type":"application/json"}:{})},
   body:body===undefined?undefined:JSON.stringify(body)});
  if(!res.ok){const json=await res.json().catch(()=>({detail:"paired_data_unavailable"}));const code=typeof json.detail==="string"?json.detail:"paired_data_unavailable";
   throw new Error(explanations[code]||code.replaceAll("_"," "));}
  return res;
 }
 async function list(){const x=await (await response("/projects/"+project)).json();setReady(x.worker_ready);setJobs(x.jobs);}
 useEffect(()=>{let live=true;
  void response("/projects/"+project).then(r=>r.json()).then(x=>{if(live){setReady(x.worker_ready);setJobs(x.jobs);}})
   .catch(e=>{if(live)setError(e instanceof Error?e.message:"Pair status unavailable.");});
  return()=>{live=false;};
 // This component is mounted only while the explicit disclosure is open.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[project]);
 const valid=available.some(x=>x.id===r1)&&available.some(x=>x.id===r2)&&r1!==r2;
 async function run(action:()=>Promise<void>){setBusy(true);setError("");try{await action();}catch(e){setError(e instanceof Error?e.message:"Paired operation failed.");}finally{setBusy(false);}}
 async function submit(){
  if(!valid)return;requestId.current??=crypto.randomUUID();
  const job=await (await response("",{project_id:project,request_id:requestId.current,read1_id:r1,read2_id:r2,title})).json();
  setSelected(job);await list();
 }
 async function load(job:Job){setSelected(await (await response("/"+job.id)).json());}
 async function download(job:Job){
  const report=await response("/"+job.id+"/report");const blob=await report.blob();const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download="genithm-paired-qc-"+job.id+".tsv";
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 }
 const active=selected&&(selected.state==="queued"||selected.state==="running");
 return <section aria-label="Complete server-side paired FASTQ check">
  <h3>Verify paired-end inputs</h3>
  <p>Choose two ready FASTQ or FASTQ.gz uploads. The worker rechecks both complete files and every ordered read identifier, then reports QC separately for R1 and R2. This does not align, merge, or quantify reads.</p>
  <p className="genithm-note">Requires the dedicated paired worker. Two active checks per project; ten new submissions per researcher per hour. This creates compute work, not another file copy.</p>
  <label htmlFor={id+"-r1"}>Read 1 <select id={id+"-r1"} value={r1} disabled={busy} onChange={e=>{setR1(e.target.value);requestId.current=null;}}>
   <option value="">Select R1</option>{available.map(x=><option key={x.id} value={x.id}>{x.original_filename} ({bytes(x.expected_bytes)})</option>)}</select></label>
  <label htmlFor={id+"-r2"}>Read 2 <select id={id+"-r2"} value={r2} disabled={busy} onChange={e=>{setR2(e.target.value);requestId.current=null;}}>
   <option value="">Select R2</option>{available.filter(x=>x.id!==r1).map(x=><option key={x.id} value={x.id}>{x.original_filename} ({bytes(x.expected_bytes)})</option>)}</select></label>
  <label htmlFor={id+"-title"}>Analysis title <input id={id+"-title"} value={title} maxLength={160} disabled={busy}
   onChange={e=>{setTitle(e.target.value);requestId.current=null;}}/></label>
  <div className="genithm-page-links">
   <button className="button primary" type="button" disabled={busy||!valid||!ready||title.trim().length<3}
    onClick={()=>void run(submit)}>Approve and run paired QC</button>
   <button className="button" type="button" disabled={busy} onClick={()=>void run(async()=>{await list();if(selected)await load(selected);})}>Refresh paired status</button>
  </div>
  <p role="status">Paired worker: {ready?"available":"not ready"}. {active?"Your queued analysis continues on the server if this tab closes.":""}</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {selected&&<article className="genithm-disclosure">
   <h4>{selected.title}</h4><p>{selected.state.replaceAll("_"," ")}</p>
   {selected.error_code&&<p role="alert">{explanations[selected.error_code]||selected.error_code.replaceAll("_"," ")}</p>}
   {active&&<><p>Source bytes read, including buffering: R1 {bytes(selected.checked_read1_bytes)} / {bytes(selected.read1_bytes)}; R2 {bytes(selected.checked_read2_bytes)} / {bytes(selected.read2_bytes)}. This is not a completed-result indicator.</p>
    <button type="button" className="button" disabled={busy} onClick={()=>void run(async()=>{setSelected(await (await response("/"+selected.id+"/cancel",{})).json());await list();})}>Cancel paired check</button></>}
   {selected.state==="ready"&&selected.result&&<>
    <p><strong>{selected.result.matched_pairs.toLocaleString()} ordered pairs matched.</strong> Every record and both source checksums were checked.</p>
    <p>{selected.result.both_mate_annotations_checked.toLocaleString()} pairs had explicit R1/R2 annotations; {selected.result.identifier_order_only_pairs.toLocaleString()} were matched by identifier order only. Identifier uniqueness and biological pairing are not asserted.</p>
    {selected.result.identical_source_bytes&&<p className="genithm-note">The two inputs have identical bytes. Check that you did not upload the same file twice.</p>}
    <table><caption>Complete paired QC (Phred+33 assumed)</caption><thead><tr><th scope="col">Input</th><th scope="col">Reads</th><th scope="col">Bases</th><th scope="col">Mean Phred</th><th scope="col">Q30 bases</th></tr></thead>
     <tbody>{(["r1","r2"] as const).map(key=>{const m=selected.result![key].metrics;return <tr key={key}><th scope="row">{key.toUpperCase()}</th><td>{m.read_count.toLocaleString()}</td><td>{m.base_count.toLocaleString()}</td><td>{m.mean_phred.toFixed(2)}</td><td>{m.q30_bases.toLocaleString()}</td></tr>;})}</tbody></table>
    <button className="button" type="button" disabled={busy} onClick={()=>void run(()=>download(selected))}>Download paired QC report</button>
    <p className="genithm-note">Checks describe the source files read during execution, not clinical validity or downstream analysis. The report contains source and result fingerprints, not raw reads.</p>
   </>}
  </article>}
  {jobs.length>0&&<details><summary>Recent paired checks ({jobs.length})</summary>{jobs.map(job=><p key={job.id}>
   <button type="button" className="button" disabled={busy} onClick={()=>void run(()=>load(job))}>{job.title}: {job.state}</button></p>)}</details>}
 </section>;
}
