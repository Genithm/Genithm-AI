/** V73: real, local, design-aware QC from the measured V72 gene cohort.
 * Does NOT infer conditions from data or run differential-expression tests.
 * The condition labels here are researcher assertions, not biological truth.
 */
import type {SalmonCohortQc} from "./salmon-gene-cohort-qc-v72";

export const COHORT_DESIGN_SCHEMA="genithm-salmon-design-cohort-qc/1";
export const MAX_DESIGN_CSV_BYTES=16*1024;
export const MAX_DESIGN_SAMPLES=24;
const SAMPLE=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const CONDITION=/^[A-Za-z][A-Za-z0-9_-]{0,47}$/;

export class SalmonDesignError extends Error{
  readonly code:string;
  constructor(code:string,message:string){super(message);this.name="SalmonDesignError";this.code=code;}
}
function reject(code:string,message:string):never{throw new SalmonDesignError(code,message);}

export type DesignCohortQc={
  schema:typeof COHORT_DESIGN_SCHEMA;
  status:"descriptive_correlations_with_researcher_labels_only";
  samples:number;
  groups:Array<{condition:string;biological_samples:number;replicates_ge_3:boolean}>;
  group_pairs:Array<{
    condition_a:string;condition_b:string;kind:"within"|"between";
    available_pairs:number;undefined_pairs:number;median_pearson_log2_tpm_plus_one:number|null;
  }>;
  group_pair_qc_tsv:string;
  matched_design_tsv:string;
  supported_two_group_replication_counts:boolean;
  warnings:string[];
  fastq_and_reference_verified:false;
  labels_biologically_verified:false;
  differential_expression_performed:false;
};
function parseDesign(csv:string):Map<string,string>{
  if(typeof csv!=="string"||!csv.trim())reject("empty","Study-design CSV is empty.");
  if(new TextEncoder().encode(csv).byteLength>MAX_DESIGN_CSV_BYTES)
    reject("size","Study-design CSV exceeds 16 KiB.");
  const source=csv.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n");
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\r]/.test(source))
    reject("control","Study design contains unsafe control characters.");
  const lines=source.split("\n");
  if(lines.at(-1)==="")lines.pop();
  if(lines.length<3||lines.length>MAX_DESIGN_SAMPLES+1||lines.some(x=>!x))
    reject("rows","Study design requires two or more samples and at most 24 rows.");
  if(lines[0]!=="sample,condition")
    reject("header","Study design requires exact sample,condition header.");
  const ids=new Map<string,string>();
  for(const [index,line] of lines.slice(1).entries()){
    const cols=line.split(",");
    if(cols.length!==2)reject("columns",`Design row ${index+2} has the wrong number of columns.`);
    const [sample,condition]=cols;
    if(!SAMPLE.test(sample)||!CONDITION.test(condition))
      reject("identifier",`Design row ${index+2} has an invalid sample/condition.`);
    if(ids.has(sample))reject("duplicate",`Duplicate design sample ${sample}.`);
    ids.set(sample,condition);
  }
  return ids;
}
function median(list:number[]):number|null{
  if(!list.length)return null;
  const sorted=[...list].sort((a,b)=>a-b);
  const i=Math.floor(sorted.length/2);
  const value=sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;
  return Number(value.toFixed(6));
}
export function inspectSalmonCohortDesign(cohort:SalmonCohortQc,csv:string):DesignCohortQc{
  if(!cohort||cohort.schema!=="genithm-salmon-gene-cohort-qc/1"||
    cohort.status!=="descriptive_imported_gene_qc_only"||
    cohort.source_fastq_verified!==false||cohort.reference_verified!==false||
    cohort.differential_expression_performed!==false||
    !Number.isSafeInteger(cohort.samples)||cohort.samples<2||cohort.samples>MAX_DESIGN_SAMPLES||
    !Array.isArray(cohort.metrics)||cohort.metrics.length!==cohort.samples||
    !Array.isArray(cohort.correlations)||
    cohort.correlations.length!==cohort.samples*(cohort.samples-1)/2)
    reject("source","Requires a valid bounded V72 gene-level cohort QC report with two or more samples.");
  const design=parseDesign(csv);
  if(design.size!==cohort.samples)reject("mismatch","Design sample count differs from observed quantification samples.");
  const observations=cohort.metrics.map(item=>item.sample);
  if(new Set(observations).size!==observations.length||observations.some(x=>!SAMPLE.test(x)))
    reject("source","Observed sample identifiers are ambiguous.");
  if(observations.some(sample=>!design.has(sample)))
    reject("mismatch","One or more measured samples have no exact matching design assignment.");
  const groups=new Map<string,number>();
  for(const sample of observations){
    const condition=design.get(sample)!;
    groups.set(condition,(groups.get(condition)??0)+1);
  }
  if(groups.size<2)reject("conditions","At least two experimental conditions are required.");
  if(groups.size>8)reject("conditions","At most eight experimental conditions may be reviewed.");
  const groupNames=[...groups.keys()].sort();
  const expected=new Set<string>();
  const buckets=new Map<string,{values:number[];missing:number}>();
  for(let i=0;i<groupNames.length;i++)for(let j=i;j<groupNames.length;j++){
    buckets.set(`${groupNames[i]}\u0000${groupNames[j]}`,{values:[],missing:0});
  }
  for(const row of cohort.correlations){
    const a=row.sample_a,b=row.sample_b,value=row.pearson_log2_tpm_plus_one;
    if(!SAMPLE.test(a)||!SAMPLE.test(b)||a===b||!design.has(a)||!design.has(b))
      reject("pair","Invalid sample identity in measured correlation output.");
    const pair=[a,b].sort().join("\u0000");
    if(expected.has(pair))reject("pair","Repeated sample pair in measured correlation output.");
    expected.add(pair);
    if(row.genes_compared!==cohort.genes||
       (value!==null&&(typeof value!=="number"||!Number.isFinite(value)||value<-1||value>1)))
      reject("correlation","Measured Pearson correlation is invalid or uses inconsistent genes.");
    const cond=[design.get(a)!,design.get(b)!].sort();
    const bucket=buckets.get(cond.join("\u0000"));
    if(!bucket)reject("source","Unexpected design group in correlation output.");
    if(value===null)bucket.missing++;
    else bucket.values.push(value);
  }
  const groupPairs:DesignCohortQc["group_pairs"]=[];
  for(let i=0;i<groupNames.length;i++)for(let j=i;j<groupNames.length;j++){
    const a=groupNames[i],b=groupNames[j];
    const bucket=buckets.get(`${a}\u0000${b}`)!;
    const expectedPairs=a===b?(groups.get(a)!*(groups.get(a)!-1)/2):groups.get(a)!*groups.get(b)!;
    if(bucket.values.length+bucket.missing!==expectedPairs)
      reject("pair","Incomplete or inconsistent measured sample-pair coverage.");
    groupPairs.push({condition_a:a,condition_b:b,kind:a===b?"within":"between",
      available_pairs:bucket.values.length,undefined_pairs:bucket.missing,
      median_pearson_log2_tpm_plus_one:median(bucket.values)});
  }
  const g=groupNames.map(condition=>({condition,biological_samples:groups.get(condition)!,replicates_ge_3:groups.get(condition)!>=3}));
  const enough=g.length===2&&g.every(x=>x.replicates_ge_3);
  const qc=["condition_a\tcondition_b\tpair_kind\tdefined_pairs\tundefined_pairs\tmedian_pearson_log2_tpm_plus_one\n"];
  for(const row of groupPairs)qc.push([row.condition_a,row.condition_b,row.kind,row.available_pairs,row.undefined_pairs,
      row.median_pearson_log2_tpm_plus_one??"NA"].join("\t")+"\n");
  const assignment=["sample\tcondition\n"];
  for(const sample of observations)assignment.push(`${sample}\t${design.get(sample)}\n`);
  return {schema:COHORT_DESIGN_SCHEMA,status:"descriptive_correlations_with_researcher_labels_only",
    samples:cohort.samples,groups:g,group_pairs:groupPairs,group_pair_qc_tsv:qc.join(""),
    matched_design_tsv:assignment.join(""),supported_two_group_replication_counts:enough,
    warnings:[
      "Group labels are supplied by the researcher and were matched to imported quantification sample IDs; their biological truth, independence, batch and reference compatibility were not verified.",
      "Within/between-group medians summarize measured V72 Pearson correlations across log2(TPM+1) genes; they are descriptive only and are not p-values, effect sizes or differential-expression significance.",
      ...(g.some(x=>x.biological_samples<3)?["One or more groups contain fewer than three biological samples; do not infer differential expression."]:[]),
      ...(g.length!==2?["This design has more than two groups; Genithm's current exploratory expression lab does not fit this study."]:[]),
      ...(groupPairs.some(x=>x.undefined_pairs>0)?["Some correlations are undefined due to zero-variance expression profiles."]:[]),
      "No Salmon reads, reference transcriptome, annotation match, gene-level length correction, DESeq2/edgeR or raw FASTQ quantification was validated or run."
    ],fastq_and_reference_verified:false,labels_biologically_verified:false,differential_expression_performed:false};
}
