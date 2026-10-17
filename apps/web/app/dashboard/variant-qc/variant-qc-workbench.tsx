"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  MAX_VCF_BYTES, parseVcfQc, vcfQcSummaryTsv,
  type VcfQcResult,
} from "@/lib/vcf-quality-control";
import { saveVariantQcSnapshot } from "./actions";
import { VariantQcSummary } from "./variant-qc-summary";
import styles from "./variant-qc.module.css";

export type QcProject = { id:string; name:string };

function fileDownload(value:string,name:string) {
  const blob=new Blob([value],{type:"text/tab-separated-values;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");
  anchor.href=url; anchor.download=name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  URL.revokeObjectURL(url);
}

export function VariantQcWorkbench({ projects }: { projects:QcProject[] }) {
  const router=useRouter();
  const [file,setFile]=useState<File|null>(null);
  const [project,setProject]=useState(projects[0]?.id??"");
  const [title,setTitle]=useState("");
  const [result,setResult]=useState<VcfQcResult|null>(null);
  const [fingerprint,setFingerprint]=useState("");
  const [running,setRunning]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [epoch,setEpoch]=useState(0);

  function clear() {
    setFile(null);setResult(null);setFingerprint("");setTitle("");setError("");
    setEpoch(x=>x+1);
  }
  async function analyze() {
    if(!file||running||saving)return;
    setRunning(true);setError("");setResult(null);setFingerprint("");
    try {
      if(file.size===0||file.size>MAX_VCF_BYTES)throw new Error("Choose an uncompressed UTF-8 VCF file smaller than 8 MiB.");
      const data=await file.arrayBuffer();
      const text=new TextDecoder("utf-8",{fatal:true}).decode(data);
      const parsed=parseVcfQc(text);
      const digest=await crypto.subtle.digest("SHA-256",data);
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      setResult(parsed);setFingerprint(hash);
      if(!title.trim())setTitle("Variant QC — "+file.name.slice(0,95));
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"VCF analysis failed.");
    } finally {setRunning(false);}
  }
  async function save() {
    if(!result||!fingerprint||saving||!project)return;
    setSaving(true);setError("");
    try {
      const data=new FormData();
      data.set("project_id",project);
      data.set("title",title);
      data.set("source_sha256",fingerprint);
      data.set("summary",JSON.stringify(result.summary));
      const response=await saveVariantQcSnapshot(data);
      if(response.id) {router.push("/dashboard/variant-qc/"+response.id);return;}
      setError(response.error??"The aggregate QC snapshot could not be saved.");
    }catch{setError("The aggregate QC snapshot could not be saved.");}
    finally{setSaving(false);}
  }
  return (
    <div className={styles.workbench}>
      <section className={styles.uploadPanel} aria-label="VCF quality-control workflow">
        <div className={styles.panelHead}>
          <span className={styles.eyebrow}>STEP 1 · IMPORT</span>
          <h2>Analyze a local VCF</h2>
          <p>Select an uncompressed VCF v4.x file. Processing occurs entirely on this device. The browser reads only fixed VCF columns; sample genotype values are never interpreted.</p>
        </div>
        <div className={styles.uploadControls}>
          <label className={styles.fileInput}>VCF file
            <input key={epoch} type="file" accept=".vcf,.txt,text/plain" disabled={running||saving}
              onChange={event=>{
                const next=event.target.files?.[0]??null;
                setFile(next);setResult(null);setFingerprint("");setError("");
              }}/>
          </label>
          <div className={styles.fileCaption}>
            <span>{file?file.name:"No VCF selected"}</span>
            {file?<small>{(file.size/1024).toFixed(1)} KiB</small>:null}
          </div>
          <div className={styles.buttons}>
            <button type="button" className={styles.primary} disabled={!file||running||saving}
              onClick={()=>void analyze()}>{running?"Analyzing VCF…":"Run real VCF QC →"}</button>
            <button type="button" className={styles.secondary} onClick={clear} disabled={running||saving}>Clear local analysis</button>
          </div>
        </div>
        {error?<p role="alert" className={styles.alert}>{error}</p>:null}
        <p className={styles.small}>Limits: 8 MiB uncompressed text · 50,000 variant records · 2,000 contigs · 80 preview rows. Gzip, breakend alleles, and VCF v3 are not supported. Genotype fields are ignored, not decoded.</p>
      </section>
      {result&&fingerprint?(
        <>
          <VariantQcSummary summary={result.summary} preview={result.preview} sourceSha256={fingerprint}/>
          <section className={styles.savePanel} aria-label="QC results export and optional persistence">
            <div>
              <span className={styles.eyebrow}>STEP 2 · EXPORT OR SAVE</span>
              <h2>Keep your QC evidence</h2>
              <p>Download a local TSV now. Saving to Supabase is optional and retains only your named aggregate summary—not the file, sample names, genotypes, or variant rows.</p>
              <button type="button" className={styles.secondary}
                onClick={()=>fileDownload(vcfQcSummaryTsv(result.summary,fingerprint),"genithm-vcf-qc-"+fingerprint.slice(0,10)+".tsv")}>
                ↓ Download QC summary TSV
              </button>
            </div>
            <div className={styles.saveForm}>
              <label>Research project
                <select value={project} onChange={event=>setProject(event.target.value)}>
                  {projects.length?projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>):
                    <option value="">No research projects available</option>}
                </select>
              </label>
              <label>Snapshot title
                <input type="text" value={title} onChange={event=>setTitle(event.target.value)}
                  minLength={3} maxLength={160} placeholder="Variant QC analysis" />
              </label>
              <button type="button" className={styles.primary}
                disabled={!project||title.trim().length<3||title.length>160||saving}
                onClick={()=>void save()}>{saving?"Saving aggregate QC…":"Save aggregate to Supabase →"}</button>
            </div>
          </section>
        </>
      ):null}
    </div>
  );
}
