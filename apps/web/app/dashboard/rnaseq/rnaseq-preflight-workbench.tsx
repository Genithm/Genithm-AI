"use client";

import {useState} from "react";
import {
  RNASEQ_MAX_MANIFEST_BYTES, RNASEQ_PINNED_VERSION,
  validateRnaSeqStudy, type RnaSeqPreflight
} from "@/lib/rnaseq-study-preflight";

const SYNTHETIC_SHEET=[
  "sample,fastq_1,fastq_2,strandedness",
  "CTRL1,reads/CTRL1_R1.fastq.gz,reads/CTRL1_R2.fastq.gz,auto",
  "CTRL2,reads/CTRL2_R1.fastq.gz,reads/CTRL2_R2.fastq.gz,auto",
  "CTRL3,reads/CTRL3_R1.fastq.gz,reads/CTRL3_R2.fastq.gz,auto",
  "TREAT1,reads/TREAT1_R1.fastq.gz,reads/TREAT1_R2.fastq.gz,auto",
  "TREAT2,reads/TREAT2_R1.fastq.gz,reads/TREAT2_R2.fastq.gz,auto",
  "TREAT3,reads/TREAT3_R1.fastq.gz,reads/TREAT3_R2.fastq.gz,auto"
].join("\n")+"\n";
const SYNTHETIC_DESIGN=[
  "sample,condition","CTRL1,control","CTRL2,control","CTRL3,control",
  "TREAT1,treated","TREAT2,treated","TREAT3,treated"
].join("\n")+"\n";

function download(content:string,filename:string,mime:string) {
  const link=document.createElement("a");
  const url=URL.createObjectURL(new Blob([content],{type:mime+";charset=utf-8"}));
  link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function sha256(input:string){
  const bytes=new TextEncoder().encode(input);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
type Result={report:RnaSeqPreflight;sampleSha:string;designSha:string;synthetic:boolean};
export function RnaSeqPreflightWorkbench(){
  const [sheet,setSheet]=useState("");
  const [design,setDesign]=useState("");
  const [synthetic,setSynthetic]=useState(false);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const reset=()=>{setResult(null);setError("");};
  async function readFile(file:File|null,kind:"sheet"|"design"){
    if(!file)return;
    reset();setSynthetic(false);
    if(file.size>RNASEQ_MAX_MANIFEST_BYTES||file.size===0){
      setError("The selected CSV must be nonempty and no larger than 512 KiB.");return;
    }
    const text=await file.text();
    if(kind==="sheet")setSheet(text);else setDesign(text);
  }
  async function check(){
    if(busy)return;
    reset();setBusy(true);
    try{
      const report=validateRnaSeqStudy(sheet,design);
      const [sampleSha,designSha]=await Promise.all([sha256(sheet),sha256(design)]);
      setResult({report,sampleSha,designSha,synthetic});
    }catch(e){
      setError(e instanceof Error?e.message:"RNA-seq input could not be validated.");
    }finally{setBusy(false);}
  }
  function exportEvidence(){
    if(!result)return;
    const {report,sampleSha,designSha}=result;
    // Manifest contains researcher-provided filenames. Nothing leaves browser unless downloaded.
    const proof={
      ...report,preflight_input_sha256:{samplesheet:sampleSha,design:designSha},
      synthetic_example:result.synthetic,
      explicit_limitation:"All RNA-seq read processing and expression inference remain unexecuted."
    };
    download(JSON.stringify(proof,null,2)+"\n","genithm-rnaseq-METADATA-ONLY-preflight.json","application/json");
  }
  return <section className="genithm-card" aria-label="RNA-seq sample manifest preflight">
    <div className="genithm-page-kicker">PHASE 1 / BULK RNA-SEQ</div>
    <h2>Validate a study design and prepare an nf-core samplesheet</h2>
    <p>Paste or select two CSV files. Validation occurs entirely in your browser. It matches biological samples, conditions, sequencing lanes and declared read pairing. The FASTQ files named in the CSV are <strong>not uploaded, opened or analyzed</strong>.</p>
    <p className="genithm-note">Target workflow: nf-core/rnaseq {RNASEQ_PINNED_VERSION} (planned executor, not installed or launched here). This page is a research-intake checker, not a transcript quantifier.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,340px),1fr))",gap:18,marginTop:16}}>
      <div>
        <label htmlFor="rnaseq-sheet"><strong>1. nf-core samplesheet (CSV)</strong></label>
        <p className="genithm-note">Required: sample,fastq_1,fastq_2,strandedness. Multiple lanes may share a sample ID.</p>
        <input aria-label="Choose RNA-seq samplesheet CSV" type="file" accept=".csv,text/csv" onChange={e=>void readFile(e.currentTarget.files?.[0]??null,"sheet")}/>
        <textarea id="rnaseq-sheet" rows={9} value={sheet} spellCheck={false} onChange={e=>{setSheet(e.target.value);setSynthetic(false);reset();}}
          placeholder="sample,fastq_1,fastq_2,strandedness" style={{width:"100%",fontFamily:"monospace",marginTop:10}}/>
      </div>
      <div>
        <label htmlFor="rnaseq-design"><strong>2. Experimental design (CSV)</strong></label>
        <p className="genithm-note">Required: sample,condition. One entry per biological sample, not per sequencing lane.</p>
        <input aria-label="Choose RNA-seq experimental design CSV" type="file" accept=".csv,text/csv" onChange={e=>void readFile(e.currentTarget.files?.[0]??null,"design")}/>
        <textarea id="rnaseq-design" rows={9} value={design} spellCheck={false} onChange={e=>{setDesign(e.target.value);setSynthetic(false);reset();}}
          placeholder="sample,condition" style={{width:"100%",fontFamily:"monospace",marginTop:10}}/>
      </div>
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:16}}>
      <button type="button" className="button" disabled={busy} onClick={()=>void check()}>
        {busy?"Checking locally…":"Validate RNA-seq study"}
      </button>
      <button type="button" className="button" onClick={()=>{setSheet(SYNTHETIC_SHEET);setDesign(SYNTHETIC_DESIGN);setSynthetic(true);reset();}}>
        Load synthetic example
      </button>
    </div>
    {error&&<p role="alert" className="error" style={{marginTop:16}}>{error}</p>}
    {result&&<div role="status" style={{marginTop:22}}>
      <h3>Metadata validated — scientific execution has not started</h3>
      {result.synthetic&&<p><strong>Synthetic demonstration data only.</strong> The listed read files do not exist.</p>}
      <p><strong>{result.report.samples}</strong> biological samples · <strong>{result.report.lanes}</strong> sequencing lanes ·
      <strong> {result.report.paired_end_lanes}</strong> paired lanes ·
      <strong> {result.report.technical_replicate_samples}</strong> multi-lane samples</p>
      <table style={{width:"100%",maxWidth:540,textAlign:"left"}}>
        <thead><tr><th scope="col">Condition</th><th scope="col">Biological samples</th></tr></thead>
        <tbody>{result.report.groups.map(group=><tr key={group.condition}>
          <td>{group.condition}</td><td>{group.biological_samples}</td>
        </tr>)}</tbody>
      </table>
      <p>{result.report.exploratory_two_group_design_sufficient
        ?"Study-design counts meet the local two-group exploratory replication threshold; raw-file and model checks remain outstanding."
        :"The design does not meet the current local two-group exploratory replication threshold."}</p>
      <h4>Not yet verified</h4>
      <ul>{result.report.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>
      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:12}}>
        <button type="button" className="button" onClick={()=>download(result.report.nfcore_samplesheet_csv,"genithm-rnaseq-samplesheet.csv","text/csv")}>Download validated samplesheet</button>
        <button type="button" className="button" onClick={()=>download(result.report.experimental_design_csv,"genithm-rnaseq-design.csv","text/csv")}>Download matched design</button>
        <button type="button" className="button" onClick={exportEvidence}>Download preflight evidence JSON</button>
      </div>
      <p className="genithm-note">Local source SHA-256 fingerprints: sample sheet {result.sampleSha.slice(0,16)}…; design {result.designSha.slice(0,16)}…. Fingerprints apply to CSV metadata only, never the actual FASTQ read files.</p>
    </div>}
  </section>;
}
