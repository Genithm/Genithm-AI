"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  analyzeFastqQc,fastqQcTsv,MAX_FASTQ_BYTES,
  type FastqQcSummary,
} from "@/lib/fastq-quality-control";
import { saveFastqQcSnapshot } from "./actions";
import { FastqQcVisualization } from "./fastq-qc-visualization";
import styles from "./fastq-qc.module.css";

type Project={id:string;name:string};
async function localSha(file:File):Promise<string>{
  const bytes=await file.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function download(data:string,name:string){
  const blob=new Blob([data],{type:"text/tab-separated-values;charset=utf-8"});
  const url=URL.createObjectURL(blob);const el=document.createElement("a");
  el.href=url;el.download=name;document.body.appendChild(el);el.click();el.remove();URL.revokeObjectURL(url);
}
export function FastqQcWorkbench({projects}:{projects:Project[]}){
  const router=useRouter();
  const [r1,setR1]=useState<File|null>(null);
  const [r2,setR2]=useState<File|null>(null);
  const [paired,setPaired]=useState(false);
  const [summary,setSummary]=useState<FastqQcSummary|null>(null);
  const [hashes,setHashes]=useState<string[]>([]);
  const [project,setProject]=useState(projects[0]?.id??"");
  const [title,setTitle]=useState("");
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  function resetResults(){setSummary(null);setHashes([]);setError("");}
  async function analyze(){
    if(!r1||busy||saving)return;
    setBusy(true);resetResults();
    try{
      const items=paired?[r1,r2]:[r1];
      if(items.some(f=>!f||f.size<4||f.size>MAX_FASTQ_BYTES))
        throw new Error("Select "+(paired?"two":"one")+" valid uncompressed FASTQ file(s), each at most 12 MiB.");
      const read=async (file:File)=>
        new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());
      const [text1,text2]=await Promise.all([read(r1),paired?read(r2!):Promise.resolve(undefined)]);
      const result=analyzeFastqQc(text1,text2);
      const fingerprints=await Promise.all(items.map(file=>localSha(file!)));
      setSummary(result);setHashes(fingerprints);
      if(!title.trim())setTitle("FASTQ QC · "+r1.name.slice(0,110));
    }catch(e){setError(e instanceof Error?e.message:"FASTQ QC failed.");}
    finally{setBusy(false);}
  }
  async function save(){
    if(!summary||!hashes.length||!project||saving)return;
    setSaving(true);setError("");
    try{
      const form=new FormData();
      form.set("project_id",project);form.set("title",title);
      form.set("summary",JSON.stringify(summary));
      form.set("source_hashes",hashes.join(","));
      const response=await saveFastqQcSnapshot(form);
      if(response.id){router.push("/dashboard/fastq-qc/"+response.id);return;}
      setError(response.error??"QC aggregate could not be saved.");
    }catch{setError("QC aggregate could not be saved.");}
    finally{setSaving(false);}
  }
  return <div className={styles.workspace}>
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>01 / LOCAL SEQUENCING QUALITY CONTROL</span>
        <h2>Import FASTQ reads</h2>
        <p>Analyze uncompressed four-line FASTQ records locally. Select one file or paired R1/R2 files; no raw reads, quality strings, sample names or identifiers are uploaded by this feature.</p>
      </div>
      <div className={styles.modeSwitch}>
        <label><input type="radio" name="readMode" checked={!paired}
          disabled={busy||saving} onChange={()=>{setPaired(false);setR2(null);resetResults();}}/> Single-end</label>
        <label><input type="radio" name="readMode" checked={paired}
          disabled={busy||saving} onChange={()=>{setPaired(true);resetResults();}}/> Paired-end (R1 + R2)</label>
      </div>
      <div className={styles.inputs}>
        <label>FASTQ {paired?"R1":"reads"}
          <input type="file" accept=".fastq,.fq,.txt,text/plain"
            disabled={busy||saving} onChange={e=>{setR1(e.target.files?.[0]??null);resetResults();}}/>
          <small>{r1?r1.name:"Select local uncompressed FASTQ"}</small>
        </label>
        {paired?<label>FASTQ R2
          <input type="file" accept=".fastq,.fq,.txt,text/plain"
            disabled={busy||saving} onChange={e=>{setR2(e.target.files?.[0]??null);resetResults();}}/>
          <small>{r2?r2.name:"Select corresponding mate FASTQ"}</small>
        </label>:null}
      </div>
      <div className={styles.buttons}>
        <button type="button" className={styles.primary} disabled={!r1||(paired&&!r2)||busy||saving}
          onClick={()=>void analyze()}>{busy?"Analyzing sequencing reads…":"Analyze actual FASTQ reads →"}</button>
        <button type="button" className={styles.secondary} disabled={busy||saving}
          onClick={()=>{setR1(null);setR2(null);setSummary(null);setHashes([]);setError("");}}>Clear results</button>
      </div>
      <p className={styles.small}>Limits: 12 MiB per uncompressed file · 100,000 reads/file · 400 bases/read. Only A/C/G/T/N sequence symbols and ASCII Phred+33 quality bytes are accepted. Quality encoding is assumed, not autodetected; verify it before analysis.</p>
      {error?<p className={styles.error} role="alert">{error}</p>:null}
    </section>
    {summary&&hashes.length?<>
      <FastqQcVisualization summary={summary} hashes={hashes}/>
      <section className={styles.panel}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>02 / DOWNLOAD OR PRESERVE AGGREGATES</span>
          <h2>Export and save quality results</h2>
          <p>Your FASTQ files remain local. The optional project snapshot stores only aggregate counts, quality curves, a researcher-defined title and client-computed hashes.</p>
        </div>
        <button type="button" className={styles.secondary}
          onClick={()=>download(fastqQcTsv(summary,hashes),"genithm-fastq-qc-"+hashes[0].slice(0,10)+".tsv")}>
          ↓ Download complete per-cycle TSV report
        </button>
        <div className={styles.inputs}>
          <label>Project
            <select value={project} onChange={e=>setProject(e.target.value)}>
              {projects.length?projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>):
                <option value="">No accessible projects</option>}
            </select>
          </label>
          <label>Snapshot title
            <input type="text" value={title} minLength={3} maxLength={160}
              onChange={e=>setTitle(e.target.value)} placeholder="Sequencing QC study"/>
          </label>
        </div>
        <button type="button" className={styles.primary}
          disabled={!project||title.trim().length<3||title.length>160||saving}
          onClick={()=>void save()}>{saving?"Saving private aggregate…":"Save aggregate to Supabase →"}</button>
      </section>
    </>:null}
  </div>;
}
