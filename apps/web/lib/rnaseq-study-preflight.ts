/** Genithm V69: strict browser-only bulk RNA-seq samplesheet and study intake.
 * Metadata only; the named FASTQ files are never opened, read or quantified.
 * Not a scientific workflow completion or an authorization for compute.
 */
export const RNASEQ_PREFLIGHT_SCHEMA="genithm-rnaseq-study-preflight/1";
export const RNASEQ_PIPELINE="nf-core/rnaseq";
export const RNASEQ_PINNED_VERSION="3.27.0";
export const RNASEQ_MAX_MANIFEST_BYTES=512*1024;
export const RNASEQ_MAX_LANES=12000;
export const RNASEQ_MAX_SAMPLES=5000;
export type RnaSeqPreflight={
  schema:typeof RNASEQ_PREFLIGHT_SCHEMA;
  status:"metadata_validated_not_executed";
  pipeline:{name:typeof RNASEQ_PIPELINE;version:typeof RNASEQ_PINNED_VERSION};
  lanes:number;samples:number;paired_end_lanes:number;single_end_lanes:number;
  technical_replicate_samples:number;
  groups:Array<{condition:string;biological_samples:number}>;
  exploratory_two_group_design_sufficient:boolean;
  warnings:string[];
  nfcore_samplesheet_csv:string;
  experimental_design_csv:string;
  prerequisites:{
    actual_fastq_bytes_verified:false;
    reference_genome_and_annotation_verified:false;
    private_compute_available:false;
    user_approved_execution:false;
    output_quantification_completed:false;
    output_differential_expression_completed:false;
  };
};
export class RnaSeqIntakeError extends Error {
  constructor(public readonly code:string,detail:string){
    super(detail);this.name="RnaSeqIntakeError";
  }
}
function reject(code:string,message:string):never{throw new RnaSeqIntakeError(code,message);}
type Table={headers:string[];rows:string[][]};
function csvTable(source:string,name:string,required:string[],allowed:string[]):Table{
  if(typeof source!=="string"||!source.trim())reject("empty",name+": CSV is empty.");
  if(new TextEncoder().encode(source).byteLength>RNASEQ_MAX_MANIFEST_BYTES)
    reject("size",name+": CSV exceeds the 512 KiB local intake limit.");
  const s=source.replace(/^\uFEFF/,"");
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s))
    reject("control",name+": CSV contains prohibited control characters.");
  const rows:string[][]=[];
  let record:string[]=[],field="",quoted=false,closed=false;
  const finishField=()=>{
    if(field.length>1024)reject("field",name+": one CSV field exceeds 1024 characters.");
    record.push(field);field="";closed=false;
  };
  const finishRow=()=>{
    finishField();
    if(record.some(value=>value!==""))rows.push(record);
    record=[];
    if(rows.length>RNASEQ_MAX_LANES+1)reject("rows",name+": too many rows.");
  };
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(quoted){
      if(ch==='"'){
        if(s[i+1]==='"'){field+='"';i++;}
        else{quoted=false;closed=true;}
      }else if(ch==="\n"||ch==="\r")reject("multiline",name+": multiline quoted cells are unsupported.");
      else field+=ch;
    }else if(ch==='"'){
      if(field!==""||closed)reject("quotes",name+": invalid quote position.");
      quoted=true;
    }else if(ch===","){finishField();}
    else if(ch==="\n"||ch==="\r"){
      if(ch==="\r"&&s[i+1]==="\n")i++;
      finishRow();
    }else{
      if(closed)reject("quotes",name+": text after closing quote.");
      field+=ch;
    }
  }
  if(quoted)reject("quotes",name+": unclosed quoted CSV field.");
  if(record.length||field!==""||closed)finishRow();
  if(rows.length<2)reject("rows",name+": header and at least one data row are required.");
  const headers=rows[0];
  if(headers.length>8||new Set(headers).size!==headers.length ||
     required.some(k=>!headers.includes(k)) ||
     headers.some(h=>!allowed.includes(h)))
    reject("header",name+": invalid, duplicated or unsupported column headers.");
  const data=rows.slice(1);
  if(data.some(r=>r.length!==headers.length))
    reject("columns",name+": inconsistent number of CSV fields.");
  return {headers,rows:data};
}
function mapped(table:Table):Array<Record<string,string>>{
  return table.rows.map(row=>Object.fromEntries(table.headers.map((key,i)=>[key,row[i]])));
}
const SAMPLE=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const CONDITION=/^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const PLATFORM=/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const CENTER=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const FASTQ=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}\.(?:fastq|fq)(?:\.gz)?$/i;
function validFastqPath(value:string):boolean{
  return FASTQ.test(value) && !value.split("/").some(p=>p==="."||p===".."||!p) &&
    !value.includes("//") && !value.startsWith("-");
}
function safeCsv(value:string){return '"' + value.replaceAll('"','""') + '"';}
function serialize(headers:string[],entries:Array<Record<string,string>>):string{
  return headers.join(",")+"\n"+entries.map(entry=>headers.map(k=>safeCsv(entry[k]??"")).join(",")).join("\n")+"\n";
}
export function validateRnaSeqStudy(samplesheet:string,design:string):RnaSeqPreflight {
  const sheet=csvTable(samplesheet,"RNA-seq samplesheet",
    ["sample","fastq_1","fastq_2","strandedness"],
    ["sample","fastq_1","fastq_2","strandedness","seq_platform","seq_center"]);
  const d=csvTable(design,"RNA-seq experimental design",["sample","condition"],
    ["sample","condition"]);
  if(sheet.rows.length>RNASEQ_MAX_LANES)reject("lanes","RNA-seq lane limit exceeded.");
  const lanes=mapped(sheet);
  const study=mapped(d);
  const sampleMeta=new Map<string,{paired:boolean;strandedness:string;platform:string;center:string;lanes:number}>();
  const paths=new Set<string>();
  let paired=0;
  for(const [index,row] of lanes.entries()){
    const line=index+2;
    if(!SAMPLE.test(row.sample))reject("sample","Samplesheet row "+line+": invalid sample identifier.");
    if(!validFastqPath(row.fastq_1) || (row.fastq_2&&!validFastqPath(row.fastq_2)))
      reject("path","Samplesheet row "+line+": expected safe relative FASTQ paths.");
    if(!["auto","unstranded","forward","reverse"].includes(row.strandedness))
      reject("strandedness","Samplesheet row "+line+": strandedness must be auto, unstranded, forward or reverse.");
    if((row.seq_platform&&!PLATFORM.test(row.seq_platform))||
       (row.seq_center&&!CENTER.test(row.seq_center)))
      reject("metadata","Samplesheet row "+line+": invalid platform or sequencing center label.");
    for(const path of [row.fastq_1,row.fastq_2].filter(Boolean)){
      if(paths.has(path))reject("duplicate_path","Samplesheet row "+line+": FASTQ path reused.");
      paths.add(path);
    }
    if(row.fastq_2)paired++;
    const metadata={
      paired:Boolean(row.fastq_2),strandedness:row.strandedness,
      platform:row.seq_platform??"",center:row.seq_center??"",lanes:1
    };
    const previous=sampleMeta.get(row.sample);
    if(previous){
      if(previous.paired!==metadata.paired || previous.strandedness!==metadata.strandedness ||
         previous.platform!==metadata.platform || previous.center!==metadata.center)
        reject("technical_lanes","Samplesheet row "+line+": inconsistent technical replicate settings.");
      previous.lanes++;
    }else sampleMeta.set(row.sample,metadata);
    if(sampleMeta.size>RNASEQ_MAX_SAMPLES)reject("samples","Too many biological samples.");
  }
  const conditions=new Map<string,number>();
  const assigned=new Set<string>();
  for(const [index,row] of study.entries()){
    if(!SAMPLE.test(row.sample)||!CONDITION.test(row.condition))
      reject("design","Design row "+(index+2)+": invalid sample or condition label.");
    if(assigned.has(row.sample))reject("duplicate_design","Design row "+(index+2)+": duplicate biological sample.");
    if(!sampleMeta.has(row.sample))reject("foreign_design","Design row "+(index+2)+": sample missing in FASTQ sheet.");
    assigned.add(row.sample);
    conditions.set(row.condition,(conditions.get(row.condition)??0)+1);
  }
  if(assigned.size!==sampleMeta.size)
    reject("missing_design","Every FASTQ biological sample needs exactly one design assignment.");
  if(conditions.size<2)
    reject("contrast","At least two biological conditions are required to plan a comparison.");
  const groups=Array.from(conditions,([condition,biological_samples])=>({condition,biological_samples}))
    .sort((a,b)=>a.condition.localeCompare(b.condition));
  const warnings=[
    "Metadata check only: FASTQ files were not opened, paired reads were not inspected and input checksums were not computed.",
    "No reference genome, gene annotation, index, genome build, strandedness truth or file path existence has been independently verified.",
    "No alignment, Salmon quantification, differential expression, results or scientific job has run.",
    "Pipeline execution requires separately deployed, approved compute with resource budgets, reference verification, project authorization and immutable input checksums."
  ];
  if(lanes.some(r=>r.strandedness==="auto"))
    warnings.push("Some library strandedness settings are 'auto' and require inference or independent confirmation.");
  if(paired>0&&paired<lanes.length)
    warnings.push("This sheet mixes paired-end and single-end lanes; verify library compatibility before running.");
  if(groups.length!==2)
    warnings.push("Current Genithm local differential-expression statistics require exactly two groups; this design has more.");
  if(groups.some(g=>g.biological_samples<3))
    warnings.push("At least one condition has fewer than three biological replicates; inferential comparisons are not ready.");
  return {
    schema:RNASEQ_PREFLIGHT_SCHEMA,status:"metadata_validated_not_executed",
    pipeline:{name:RNASEQ_PIPELINE,version:RNASEQ_PINNED_VERSION},
    lanes:lanes.length,samples:sampleMeta.size,paired_end_lanes:paired,
    single_end_lanes:lanes.length-paired,
    technical_replicate_samples:[...sampleMeta.values()].filter(v=>v.lanes>1).length,
    groups,exploratory_two_group_design_sufficient:groups.length===2&&groups.every(g=>g.biological_samples>=3),
    warnings,
    nfcore_samplesheet_csv:serialize(sheet.headers,lanes),
    experimental_design_csv:serialize(d.headers,study),
    prerequisites:{
      actual_fastq_bytes_verified:false,
      reference_genome_and_annotation_verified:false,
      private_compute_available:false,
      user_approved_execution:false,
      output_quantification_completed:false,
      output_differential_expression_completed:false
    }
  };
}
