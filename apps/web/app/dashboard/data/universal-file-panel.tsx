"use client";
import {useEffect,useRef,useState} from "react";
import {planBatch,transferFile,type Api,type BatchSource,type FileSession} from "@/lib/file-batch-transfer";
import styles from "./quality-report.module.css";

export type FileCatalog={version:string;formats:{id:string;label:string;category:string;extensions:string[]}[]};
export type FileLimits={enabled:boolean;max_file_bytes:number;capacity_bytes:number;charged_bytes:number;file_uploads_version?:number;file_verifier_ready?:boolean};
type Entry=BatchSource&{state:string;bytes:number;phase:string;attempted:boolean};
type StoredFile=FileSession&{project_id:string;original_filename:string;actual_sha256?:string;relative_path?:string;batch_id?:string;
 summary?:{intake?:{inspection:string;observed_header:string;fasta?:{record_count:number;symbol_count:number}|null};metrics?:{schema?:string;record_count?:number;snv_sites?:number;indel_sites?:number;sample_count?:number;transitions?:number;transversions?:number}|null}};
type Page={files:StoredFile[];next:string|null;project_id:string;batch_id:string|null};
const amount=(n:number)=>n<1024?`${n} bytes`:n<1024**2?`${(n/1024).toFixed(1)} KiB`:n<1024**3?`${(n/1024**2).toFixed(1)} MiB`:`${(n/1024**3).toFixed(2)} GiB`;

export function UniversalFilePanel(props:{project:string;limits:FileLimits;catalog?:FileCatalog;api:Api;blocked:boolean;
 onBusy:(value:boolean)=>void;onResume:(id:string)=>Promise<void>;download:(path:string,format:"json"|"tsv")=>Promise<void>}){
 const [open,setOpen]=useState(false);
 return <details className="genithm-disclosure" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Upload a batch or folder / browse all research files</summary>
  {open?<BatchWorkspace {...props}/>:null}
 </details>;
}

function BatchWorkspace({project,limits,catalog,api,blocked,onBusy,onResume,download}:Parameters<typeof UniversalFilePanel>[0]){
 const [entries,setEntries]=useState<Entry[]>([]),[running,setRunning]=useState(false),[error,setError]=useState("");
 const [mode,setMode]=useState<"auto"|"preserve">("auto"),[filter,setFilter]=useState("");
 const [records,setRecords]=useState<StoredFile[]>([]),[next,setNext]=useState<string|null>(null),[loading,setLoading]=useState(false);
 const batch=useRef(crypto.randomUUID()),controller=useRef<AbortController|null>(null),mounted=useRef(true);
 const folderInput=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{mounted.current=true;folderInput.current?.setAttribute("webkitdirectory","");return()=>{mounted.current=false;controller.current?.abort();onBusy(false);};},[]); // project-keyed workspace
 const update=(id:string,patch:Partial<Entry>)=>{if(mounted.current)setEntries(old=>old.map(e=>e.requestId===id?{...e,...patch}:e));};
 const unavailable=limits.file_uploads_version!==47;
 const ready=limits.enabled&&limits.file_verifier_ready&&!unavailable;
 const busy=running||blocked;
 function choose(files:FileList|null){
  setError("");if(!files)return;
  try{const chosen=planBatch(Array.from(files),limits.max_file_bytes);batch.current=crypto.randomUUID();
   setEntries(chosen.map(e=>({...e,state:"waiting",bytes:0,phase:"",attempted:false})));}
  catch(e){setEntries([]);setError(e instanceof Error?e.message:"Unable to select files.");}
 }
 async function hash(file:File,signal:AbortSignal,onBytes:(n:number)=>void){
  return new Promise<string>((resolve,reject)=>{
   const worker=new Worker(new URL("./large-data-hash.worker.ts",import.meta.url));
   const clean=()=>{worker.terminate();signal.removeEventListener("abort",abort);};
   const abort=()=>{clean();reject(new DOMException("Hashing paused","AbortError"));};
   if(signal.aborted){abort();return;}signal.addEventListener("abort",abort,{once:true});
   worker.onmessage=event=>{if(event.data.bytes!==undefined)onBytes(event.data.bytes);if(event.data.sha256||event.data.error){clean();event.data.error?reject(new Error(event.data.error)):resolve(event.data.sha256);}};
   worker.onerror=()=>{clean();reject(new Error("Source hashing failed."));};worker.postMessage(file);
  });
 }
 async function run(){
  if(busy||!ready||!entries.length)return;
  const control=new AbortController();controller.current=control;setRunning(true);onBusy(true);setError("");
  try{
   for(const entry of entries){
    if(["uploaded","verifying","ready"].includes(entry.state))continue;
    if(control.signal.aborted)break;
    update(entry.requestId,{attempted:true,state:"working"});
    try{
     const result=await transferFile({source:entry,project,batchId:batch.current,mode,api,signal:control.signal,hash,
      progress:(phase,bytes)=>update(entry.requestId,{phase,bytes}),
      session:value=>update(entry.requestId,{uploadId:value.id,state:value.state})});
     update(entry.requestId,{state:result.state,phase:"Server verification is separate from upload",bytes:entry.file.size});
    }catch(e){update(entry.requestId,{state:"stopped"});throw e;}
   }
  }catch(e){if(mounted.current)setError(control.signal.aborted?"Batch paused. Confirmed storage parts are retained; continue with the same selected files.":(e instanceof Error?e.message:"Batch stopped."));}
  finally{if(mounted.current)setRunning(false);onBusy(false);controller.current=null;}
 }
 async function load(more=false){
  if(loading)return;setLoading(true);setError("");
  try{const page=await api<Page>("/projects/"+project+"/files"+(more&&next?"?before="+encodeURIComponent(next):""));
   if(page.project_id!==project)throw new Error("Unexpected file-library scope.");
   if(mounted.current){setRecords(old=>more?[...old,...page.files.filter(f=>!old.some(x=>x.id===f.id))]:page.files);setNext(page.next);}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Could not load file library.");}
  finally{if(mounted.current)setLoading(false);}
 }
 async function downloadOriginal(id:string){setError("");try{
   const result=await api<{url:string;method:string;expires_seconds:number;source_sha256:string;source_bytes:number}>("/uploads/"+id+"/download");
   const url=new URL(result.url);
   if(!["https:","http:"].includes(url.protocol)||url.username||url.password||result.method!=="GET"||result.expires_seconds>120)
     throw new Error("Unexpected download authorization.");
   const link=document.createElement("a");link.href=url.href;link.rel="noreferrer noopener";link.target="_blank";
   document.body.appendChild(link);link.click();link.remove();
   setError("Download authorized. Compare the downloaded SHA-256 with "+result.source_sha256+" ("+result.source_bytes+" bytes). Do not treat stored files as malware-scanned.");
  }catch(e){setError(e instanceof Error?e.message:"Original download unavailable.");}}
 async function exportReport(id:string){setError("");try{await download("/uploads/"+id+"/file-report","json");}catch(e){setError(e instanceof Error?e.message:"File report unavailable.");}}
 const complete=entries.filter(e=>["uploaded","verifying","ready"].includes(e.state)).length;
 const matching=(catalog?.formats||[]).filter(f=>[f.label,f.category,...f.extensions].join(" ").toLowerCase().includes(filter.toLowerCase()));
 return <section className={styles.controls} aria-label="Universal bioinformatics file workspace">
  <h3>Bioinformatics file workspace</h3>
  <p>Choose files of any format, or a folder with related files and indexes. Unknown and proprietary formats are preserved as private bytes. Each file keeps its source path and checksum.</p>
  <p className="genithm-note">Uploads never execute scripts, deserialize objects, extract archives, or scan for malware. A verified checksum is not a safety certification or a completed biological analysis.</p>
  {unavailable&&<p role="status">The universal file database update is not available on this server yet. Existing single-file uploads are unchanged.</p>}
  {!unavailable&&!limits.file_verifier_ready&&<p role="status">The universal-file worker is offline. Existing stored files remain accessible; new batch admission is paused.</p>}
  <details><summary>Supported file families and inspection levels</summary>
   <label>Find a format <input type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="BAM, single-cell, proteomics..."/></label>
   <p>Automatic complete inspection: FASTQ read QC and FASTA structural statistics, plain or gzip/BGZF. Other formats receive full-byte integrity verification and bounded header hints only. Names are not proof of format.</p>
   <div style={{maxHeight:320,overflow:"auto"}}><table className="genithm-table"><caption>Recognized name hints; other extensions are also accepted</caption><thead><tr><th scope="col">Family</th><th scope="col">Format</th><th scope="col">Extensions</th></tr></thead><tbody>
    {matching.map(f=><tr key={f.id}><td>{f.category}</td><td>{f.label}</td><td>{f.extensions.map(x=>"."+x).join(", ")}</td></tr>)}
   </tbody></table></div>
  </details>
  <label>Choose multiple research files <input type="file" multiple style={{maxWidth:"100%"}} disabled={busy||unavailable} onChange={e=>choose(e.target.files)}/></label>
  <label>Choose a research folder <input ref={folderInput} type="file" multiple style={{maxWidth:"100%"}} disabled={busy||unavailable} onChange={e=>choose(e.target.files)}/></label>
  <p className="genithm-note">Up to 100 nonempty files per selection, within project limits. Folder selection depends on browser support. Selecting again starts a new batch without deleting previously uploaded files.</p>
  <label>Inspection mode <select value={mode} disabled={busy||entries.some(e=>e.attempted)} onChange={e=>setMode(e.target.value as "auto"|"preserve")}>
   <option value="auto">Inspect supported formats; preserve all others</option><option value="preserve">Preserve bytes only; do not parse FASTA, FASTQ or VCF</option>
  </select></label>
  {entries.length>0&&<p role="status">{entries.length} selected files / {amount(entries.reduce((n,e)=>n+e.file.size,0))}. {complete} uploads accepted by the server; verification may still be pending.</p>}
  <div className="genithm-page-links">
   <button className="button primary" disabled={busy||!ready||!entries.length||complete===entries.length} onClick={()=>void run()}>Start or continue batch</button>
   <button className="button" disabled={!running} onClick={()=>controller.current?.abort()}>Pause batch</button>
  </div>
  {entries.length>0&&<div style={{maxHeight:320,overflow:"auto"}}><table className="genithm-table"><caption>Current selection; no file bytes are stored in browser checkpoints</caption><thead><tr><th scope="col">Relative source path</th><th scope="col">Size</th><th scope="col">State</th></tr></thead><tbody>
   {entries.map(e=><tr key={e.requestId}><td style={{overflowWrap:"anywhere"}}>{e.path}</td><td>{amount(e.file.size)}</td><td>{e.state.replaceAll("_"," ")}{e.phase?` / ${e.phase}: ${amount(e.bytes)}`:""}</td></tr>)}
  </tbody></table></div>}
  <p className="genithm-note">A stopped batch retains completed uploads. After closing the tab, use each server upload's resume control with its identical local file. This is not algorithm checkpoint-resume.</p>
  {error&&<p className="error" role="alert">{error}</p>}
  <h3>All project files</h3><p>Owner-scoped, paginated history, including individual files from folder uploads. Refresh to see actual worker results.</p>
  <button className="button" disabled={loading||unavailable} onClick={()=>void load()}>Refresh file library</button>
  {records.map(record=><article className="genithm-disclosure" key={record.id}>
   <h4 style={{overflowWrap:"anywhere"}}>{record.relative_path||record.original_filename}</h4><p>{amount(record.expected_bytes)} / {record.state.replaceAll("_"," ")}</p>
   {record.summary?.intake&&<p>Inspection: {record.summary.intake.inspection.replaceAll("_"," ")}. Observed header: {record.summary.intake.observed_header.replaceAll("_"," ")} (bounded hint).</p>}
   {record.summary?.intake?.fasta&&<p>Complete FASTA scan: {record.summary.intake.fasta.record_count.toLocaleString()} records, {record.summary.intake.fasta.symbol_count.toLocaleString()} sequence symbols. Alphabet was not inferred.</p>}
   {record.summary?.metrics?.schema==="genithm-vcf-site-qc/1"&&<><p>Complete VCF site QC: {(record.summary.metrics.record_count??0).toLocaleString()} records, {(record.summary.metrics.snv_sites??0).toLocaleString()} SNV sites, {(record.summary.metrics.indel_sites??0).toLocaleString()} indel sites, {(record.summary.metrics.sample_count??0).toLocaleString()} sample columns. Genotypes, allele frequencies and pathogenicity were not analyzed.</p><button className="button" type="button" onClick={()=>void download("/uploads/"+record.id+"/quality-report","tsv")}>Download VCF site-QC table</button></>}
   {record.state==="ready"&&<button className="button" onClick={()=>void exportReport(record.id)}>Download verified file report</button>}
   {record.state==="ready"&&<button className="button" onClick={()=>void downloadOriginal(record.id)}>Download original file (private link)</button>}
   {record.state==="uploading"&&<button className="button" disabled={busy} onClick={()=>void onResume(record.id).catch(e=>setError(e instanceof Error?e.message:"Could not select upload."))}>Select this file to resume above</button>}
  </article>)}
  {next&&<button className="button" disabled={loading} onClick={()=>void load(true)}>Load more files</button>}
 </section>;
}
