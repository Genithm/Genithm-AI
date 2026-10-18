"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {PairedDataDisclosure} from "./paired-data-panel";

type Project={id:string;name:string};
type Upload={id:string;project_id:string;original_filename:string;expected_bytes:number;expected_sha256:string;
 data_format:"fastq"|"fastq.gz"|"opaque";state:string;part_bytes?:number;checked_bytes:number;error_code:string|null;
 summary?:{scientific_scope:string;metrics?:{read_count:number;base_count:number;mean_phred:number;q30_bases:number;gc_percent:number|null}|null};
 parts?:{number:number;size:number}[]};
type Overview={limits:{enabled:boolean;capacity_bytes:number;charged_bytes:number;max_file_bytes:number;verifier_ready:boolean};uploads:Upload[]};
const API_BASE=(process.env.NEXT_PUBLIC_GENITHM_API_URL||"").replace(/\/$/,"");
const API=API_BASE+"/api/v1/large-data";
const size=(n:number)=>(n/1024**3).toFixed(2)+" GiB";
const explain=(code:string)=>({large_data_not_enabled:"Large-file storage has not been enabled on this server.",
 quota_not_configured:"Your project needs an administrator-approved storage allowance.",quota_exceeded:"This file exceeds the project's available storage allowance.",
 verifier_not_ready:"The large-file verification worker is offline. Upload admission is paused.",
 upload_links_still_active:"Pause the upload and wait seven minutes before cleanup. Existing upload links must expire first.",
 source_in_active_pair:"Cancel the active paired check before removing either of its sources.",
 operation_in_progress:"The server is finishing an operation. Refresh its status; do not start a duplicate upload.",
 large_data_operation_uncertain_retry_status_first:"The operation outcome is uncertain. Refresh status before retrying."}[code]||code.replaceAll("_"," "));

export function LargeDataPanel({projects}:{projects:Project[]}){
 const db=useMemo(()=>createClient(),[]);
 const [project,setProject]=useState(projects[0]?.id||"");const [overview,setOverview]=useState<Overview|null>(null);
 const [file,setFile]=useState<File|null>(null);const [current,setCurrent]=useState<Upload|null>(null);
 const [busy,setBusy]=useState(false);const [stage,setStage]=useState("");const [bytes,setBytes]=useState(0);
 const [error,setError]=useState("");const paused=useRef(false);const hashWorker=useRef<Worker|null>(null);const cancelHash=useRef<(()=>void)|null>(null);
 const inFlight=useRef(new Set<AbortController>());const requestId=useRef<string|null>(null);
 async function call<T>(path:string,body?:unknown,method?:string):Promise<T>{
  if(!API_BASE)throw new Error("The private large-data API has not been configured.");
  const {data,error:authError}=await db.auth.getSession();const token=data.session?.access_token;
  if(authError||!token)throw new Error("Sign in again before using private storage.");
  const response=await fetch(API+path,{method:method||(body===undefined?"GET":"POST"),cache:"no-store",
   headers:{Authorization:"Bearer "+token,...(body!==undefined?{"Content-Type":"application/json"}:{})},
   body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok){const json=await response.json().catch(()=>({detail:"large_data_unavailable"}));throw new Error(explain(typeof json.detail==="string"?json.detail:"large_data_unavailable"));}
  return response.json() as Promise<T>;
 }
 async function refresh(){
  if(!project)return;setError("");try{setOverview(await call<Overview>("/projects/"+project));
   if(current)setCurrent(await call<Upload>("/uploads/"+current.id));}catch(e){setError(e instanceof Error?e.message:"Could not load storage status.");}
 }
 useEffect(()=>{let live=true;setOverview(null);setCurrent(null);setError("");
  if(project)void call<Overview>("/projects/"+project).then(v=>{if(live)setOverview(v);}).catch(e=>{if(live)setError(e.message);});
  return()=>{live=false;};
 // Project switching resets all selection state; explicit refresh avoids polling hidden panels.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[project]);
 useEffect(()=>()=>{paused.current=true;cancelHash.current?.();hashWorker.current?.terminate();for(const c of inFlight.current)c.abort();},[]);
 async function fingerprint(source:File){
  return new Promise<string>((resolve,reject)=>{
   const worker=new Worker(new URL("./large-data-hash.worker.ts",import.meta.url));hashWorker.current=worker;
   cancelHash.current=()=>{worker.terminate();hashWorker.current=null;cancelHash.current=null;reject(new Error("Source hashing paused."));};
   worker.onmessage=e=>{if(e.data.bytes)setBytes(e.data.bytes);if(e.data.sha256||e.data.error){worker.terminate();hashWorker.current=null;cancelHash.current=null;
     if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.sha256);}};
   worker.onerror=()=>{worker.terminate();hashWorker.current=null;cancelHash.current=null;reject(new Error("Source fingerprinting failed."));};worker.postMessage(source);
  });
 }
 function pause(){paused.current=true;cancelHash.current?.();for(const c of inFlight.current)c.abort();}
 async function transfer(){
  if(!file||!overview||busy)return;setBusy(true);setError("");paused.current=false;
  let session=current;
  try{
   if(file.size<1||file.size>overview.limits.max_file_bytes)throw new Error("This file exceeds the configured project limit.");
   setStage("Checking the complete source fingerprint");setBytes(0);const sha=await fingerprint(file);
   if(paused.current){setStage("Paused before transfer");return;}
   if(session){
    session=await call<Upload>("/uploads/"+session.id);
    if(session.expected_sha256!==sha||session.expected_bytes!==file.size)throw new Error("The selected file is not the exact content of this upload. No parts were sent.");
   }else{
    requestId.current??=crypto.randomUUID();
    const data_format=file.name.toLowerCase().match(/\.(fastq|fq)\.gz$/)?"fastq.gz":file.name.toLowerCase().match(/\.(fastq|fq)$/)?"fastq":"opaque";
    session=await call<Upload>("/uploads",{project_id:project,request_id:requestId.current,filename:file.name,expected_bytes:file.size,expected_sha256:sha,data_format});
   }
   setCurrent(session);
   if(session.state!=="uploading"){setStage("Server state: "+session.state.replaceAll("_"," "));return;}
   const known=await call<Upload>("/uploads/"+session.id);const chunk=known.part_bytes||64*1024**2;
   const done=new Set<number>();let acknowledged=0;
   for(const part of known.parts||[]){if(part.size!==Math.min(chunk,file.size-(part.number-1)*chunk))throw new Error("Remote part geometry mismatch.");done.add(part.number);acknowledged+=part.size;}
   const missing=Array.from({length:Math.ceil(file.size/chunk)},(_,i)=>i+1).filter(n=>!done.has(n));let next=0;
   setBytes(acknowledged);setStage("Uploading directly to private storage");
   const uploadId=session.id;
   async function runner(){while(!paused.current&&next<missing.length){const number=missing[next++];
    const signed=await call<{url:string;bytes:number;headers:Record<string,string>}>("/uploads/"+uploadId+"/parts/"+number,{});
    if(paused.current)return;
    const controller=new AbortController();inFlight.current.add(controller);
    try{const response=await fetch(signed.url,{method:"PUT",headers:signed.headers,body:file!.slice((number-1)*chunk,(number-1)*chunk+signed.bytes),
      signal:controller.signal,credentials:"omit",referrerPolicy:"no-referrer"});
     if(!response.ok)throw new Error("A storage part was not acknowledged. Resume to reconcile received parts.");
     acknowledged+=signed.bytes;setBytes(acknowledged);
    }finally{inFlight.current.delete(controller);}
   }}
   const outcomes=await Promise.allSettled([runner(),runner()]);
   const failed=outcomes.find(r=>r.status==="rejected");
   if(paused.current){setStage("Paused. Confirmed parts will be reused when you resume.");return;}
   if(failed&&failed.status==="rejected")throw failed.reason;
   setStage("Finalizing upload; verification runs in the background");
   setCurrent(await call<Upload>("/uploads/"+uploadId+"/complete",{}));setStage("Uploaded. Not yet verified; refresh status for the server result.");
   setOverview(await call<Overview>("/projects/"+project));
  }catch(e){if(paused.current){setError("");setStage("Paused. Confirmed parts remain on the server.");}else{setError(e instanceof Error?e.message:"Upload interrupted.");setStage("Stopped; refresh status before retrying.");}}
  finally{setBusy(false);}
 }
 async function cleanup(item:Upload){setError("");try{await call("/uploads/"+item.id+"/abort",{});if(current?.id===item.id)setCurrent(null);setOverview(await call<Overview>("/projects/"+project));}
  catch(e){setError(e instanceof Error?e.message:"Cleanup not confirmed; storage remains reserved.");}}
 return <section className="genithm-page" aria-label="Managed large-file uploads">
  <h2>Large research files</h2><p>Resumable private uploads and server-side verification. FASTQ and FASTQ.gz receive complete aggregate read QC; other formats receive byte-integrity checks only.</p>
  <label>Research project <select value={project} disabled={busy} onChange={e=>{setProject(e.target.value);requestId.current=null;setFile(null);}}>
   {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {overview&&<p className="genithm-note">{size(overview.limits.charged_bytes)} reserved or stored / {size(overview.limits.capacity_bytes)} allowed.
   Per-file ceiling: {size(overview.limits.max_file_bytes)}. Verifier: {overview.limits.verifier_ready?"available":"offline"}.</p>}
  <label>Source file <input type="file" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]||null);requestId.current=null;}}/></label>
  {current&&<p>Selected server upload: {current.original_filename} ({current.state}). Choose the identical source file to resume.</p>}
  <div className="genithm-page-links">
   <button className="button primary" type="button" disabled={busy||!file||!overview?.limits.enabled||(!current&&!overview.limits.verifier_ready)} onClick={()=>void transfer()}>{current?"Resume selected upload":"Start private upload"}</button>
   <button className="button" type="button" disabled={!busy} onClick={pause}>Pause transfer</button>
   <button className="button" type="button" disabled={busy} onClick={()=>void refresh()}>Refresh server status</button>
   <button className="button" type="button" disabled={busy} onClick={()=>{setCurrent(null);requestId.current=null;setStage("");}}>New upload</button>
  </div>
  {stage&&<p role="status">{stage} {file&&busy?`${size(bytes)} / ${size(file.size)} in this phase`:""}</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  <p className="genithm-note">Closing the tab pauses browser uploads, not already-queued server verification. Resume from the server list with the same file. This uploader does not store access tokens or signed URLs in upload checkpoints. A 100 GiB policy ceiling is not a promise that every analysis supports that size.</p>
  {overview?.uploads.map(item=><article key={item.id} className="genithm-disclosure">
   <h3>{item.original_filename}</h3><p>{size(item.expected_bytes)} · {item.state.replaceAll("_"," ")}{item.error_code?" · "+item.error_code.replaceAll("_"," "):""}</p>
   {item.state==="uploading"&&<button className="button" disabled={busy} onClick={()=>{setCurrent(item);requestId.current=null;}}>Select to resume</button>}
   {item.state==="ready"&&item.summary?.metrics&&<p>Server QC: {item.summary.metrics.read_count.toLocaleString()} reads · {item.summary.metrics.base_count.toLocaleString()} bases · mean Phred {item.summary.metrics.mean_phred.toFixed(2)}. Complete data scanned, not sampled.</p>}
   {item.state==="ready"&&item.summary?.scientific_scope==="bytes_only"&&<p>All file bytes verified. No biological analysis has been performed.</p>}
   {!['aborted','verifying','completing'].includes(item.state)&&<details><summary>Remove upload and stored bytes</summary><p>Quota is released only after confirmed cleanup. Active upload links must expire first.</p><button disabled={busy} className="button" onClick={()=>void cleanup(item)}>Confirm removal</button></details>}
  </article>)}
  {overview&&<PairedDataDisclosure key={project} project={project} uploads={overview.uploads}/>}
 </section>;
}
