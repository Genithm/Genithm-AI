/** Genithm V72: deterministic descriptive cohort QC of V71 gene summaries.
 * No differential-expression tests, p-values, classification or clinical claims.
 * Pearson correlation is evaluated across genes on log2(gene TPM + 1).
 */
import type {SalmonGeneSummary} from "./salmon-gene-summary-v71";

export const GENITHM_SALMON_COHORT_SCHEMA="genithm-salmon-gene-cohort-qc/1";
export const MAX_COHORT_CELLS=1000000;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:|\-]{0,253}$/;
const SAMPLE=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const DECIMAL=/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export type SalmonCohortQc={
  schema:typeof GENITHM_SALMON_COHORT_SCHEMA;
  status:"descriptive_imported_gene_qc_only";
  genes:number;
  samples:number;
  metrics:Array<{sample:string;genes_tpm_ge_1:number;nonzero_genes:number;
    summed_gene_tpm:number;summed_estimated_fragments:number}>;
  correlations:Array<{sample_a:string;sample_b:string;genes_compared:number;
    pearson_log2_tpm_plus_one:number|null}>;
  sample_qc_tsv:string;
  correlation_tsv:string;
  warnings:string[];
  source_fastq_verified:false;
  reference_verified:false;
  differential_expression_performed:false;
};
export class SalmonCohortQcError extends Error {
  readonly code:string;
  constructor(code:string,message:string){super(message);this.code=code;this.name="SalmonCohortQcError";}
}
function fail(code:string,detail:string):never{throw new SalmonCohortQcError(code,detail);}
function parseMatrix(text:string,samples:number,label:string):{names:string[];ids:string[];values:number[][]}{
  if(typeof text!=="string" || text.length>112*1024*1024)
    fail("size",label+": invalid matrix or excessive size.");
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\r]/.test(text))
    fail("control",label+": invalid control character.");
  const lines=text.split("\n");
  if(lines.at(-1)==="")lines.pop();
  if(lines.length<2)fail("matrix",label+": no matrix records.");
  const header=lines[0].split("\t");
  if(header[0]!=="gene_id"||header.length!==samples+1 ||
     header.slice(1).some(s=>!SAMPLE.test(s)) || new Set(header.slice(1)).size!==samples)
    fail("header",label+": invalid gene or sample header.");
  if((lines.length-1)*samples>MAX_COHORT_CELLS)
    fail("cells",label+": more than one million gene/sample cells.");
  const ids:string[]=[],values:number[][]=[],seen=new Set<string>();
  for(let i=1;i<lines.length;i++){
    const fields=lines[i].split("\t");
    if(fields.length!==samples+1||!ID.test(fields[0])||seen.has(fields[0]))
      fail("matrix",label+": invalid or duplicate gene row.");
    seen.add(fields[0]);ids.push(fields[0]);
    const row=fields.slice(1).map(v=>{
      if(!DECIMAL.test(v))fail("number",label+": nonnumeric result.");
      const n=Number(v);
      if(!Number.isFinite(n)||n<0||n>1e14)fail("range",label+": nonfinite/out-of-range value.");
      return n;
    });
    values.push(row);
  }
  return {names:header.slice(1),ids,values};
}
function close(actual:number,expected:number,transcripts:number,genes:number){
  return Number.isFinite(expected)&&expected>=0 &&
    Math.abs(actual-expected)<=Math.max(0.00001,0.000001*transcripts,0.0000006*genes);
}
function evidenceNumber(value:number){
  if(!Number.isFinite(value)||value<0)fail("overflow","Nonfinite aggregate in cohort summary.");
  return Number(value.toFixed(6));
}
export function inspectSalmonGeneCohort(summary:SalmonGeneSummary):SalmonCohortQc{
  if(!summary||summary.schema!=="genithm-salmon-gene-summary/1" ||
     summary.status!=="summarized_external_salmon_outputs_only" ||
     summary.source_reads_verified!==false || summary.transcriptome_reference_verified!==false ||
     summary.tximport_equivalent!==false||summary.gene_level_differential_expression_performed!==false ||
     !Number.isSafeInteger(summary.samples)||summary.samples<1||summary.samples>24||
     !Number.isSafeInteger(summary.genes)||summary.genes<1||
     !Number.isSafeInteger(summary.transcripts)||summary.transcripts<1||
     summary.genes*summary.samples>MAX_COHORT_CELLS ||
     !Array.isArray(summary.sample_summaries)||summary.sample_summaries.length!==summary.samples)
    fail("source","Cohort QC requires a valid bounded V71 imported gene summary.");
  const tpm=parseMatrix(summary.gene_tpm_tsv,summary.samples,"Gene TPM");
  const fragment=parseMatrix(summary.gene_estimated_fragments_tsv,summary.samples,"Gene estimated fragments");
  if(tpm.ids.length!==summary.genes || fragment.ids.length!==summary.genes ||
     tpm.names.join("\u0000")!==fragment.names.join("\u0000") ||
     tpm.ids.some((id,i)=>id!==fragment.ids[i]))
    fail("reference","Gene TPM and fragment matrices disagree on genes or sample order.");
  const n=summary.samples;
  const totalTpm=Array(n).fill(0) as number[];
  const totalFragments=Array(n).fill(0) as number[];
  const detected=Array(n).fill(0) as number[];
  const nonzero=Array(n).fill(0) as number[];
  const means=Array(n).fill(0) as number[];
  const m2=Array(n).fill(0) as number[];
  const covariance=Array.from({length:n},()=>Array(n).fill(0) as number[]);
  for(let i=0;i<tpm.values.length;i++){
    const x=Array(n).fill(0) as number[];
    for(let j=0;j<n;j++){
      const a=tpm.values[i][j],b=fragment.values[i][j];
      totalTpm[j]+=a;totalFragments[j]+=b;
      if(a>=1)detected[j]++;
      if(a>0)nonzero[j]++;
      x[j]=Math.log2(a+1);
    }
    const k=i+1;
    const diff=x.map((v,j)=>v-means[j]);
    for(let j=0;j<n;j++){
      means[j]+=diff[j]/k;
      m2[j]+=diff[j]*(x[j]-means[j]);
    }
    for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){
      covariance[a][b]+=diff[a]*(x[b]-means[b]);
    }
  }
  const metrics=summary.sample_summaries.map((item,i)=>{
    if(item.sample!==tpm.names[i] ||
       !close(totalTpm[i],item.summarized_gene_tpm,summary.transcripts,summary.genes)||
       !close(totalFragments[i],item.summarized_gene_estimated_fragments,summary.transcripts,summary.genes))
      fail("conservation","Gene TPM/estimated-fragment totals differ from the verified summary.");
    return {sample:item.sample,genes_tpm_ge_1:detected[i],nonzero_genes:nonzero[i],
      summed_gene_tpm:evidenceNumber(totalTpm[i]),
      summed_estimated_fragments:evidenceNumber(totalFragments[i])};
  });
  const correlations:SalmonCohortQc["correlations"]=[];
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){
    const denominator=Math.sqrt(m2[a]*m2[b]);
    const r=denominator>1e-12 ? Math.max(-1,Math.min(1,covariance[a][b]/denominator)) : null;
    correlations.push({sample_a:tpm.names[a],sample_b:tpm.names[b],
      genes_compared:summary.genes,pearson_log2_tpm_plus_one:r===null?null:Number(r.toFixed(6))});
  }
  const sampleLines=["sample\tgenes_tpm_ge_1\tnonzero_genes\tsummed_gene_tpm\tsummed_estimated_fragments\n"];
  for(const item of metrics)sampleLines.push([item.sample,item.genes_tpm_ge_1,item.nonzero_genes,
    item.summed_gene_tpm,item.summed_estimated_fragments].join("\t")+"\n");
  const corrLines=["sample_a\tsample_b\tgenes_compared\tpearson_log2_tpm_plus_one\n"];
  for(const c of correlations)corrLines.push([c.sample_a,c.sample_b,c.genes_compared,
    c.pearson_log2_tpm_plus_one===null?"NA":c.pearson_log2_tpm_plus_one].join("\t")+"\n");
  return {
    schema:GENITHM_SALMON_COHORT_SCHEMA,status:"descriptive_imported_gene_qc_only",
    genes:summary.genes,samples:n,metrics,correlations,
    sample_qc_tsv:sampleLines.join(""),correlation_tsv:corrLines.join(""),
    warnings:[
      ...(summary.genes<20?["Fewer than 20 mapped genes: sample correlations can be extremely unstable and must not be used as evidence of biological identity."]:[]),
      "Detection is defined as gene TPM >= 1; this is a descriptive user-facing threshold, not a gene-expression significance test.",
      "Pearson correlations use log2(gene TPM + 1) across all mapped genes. Zero-variance samples have undefined (NA) correlations.",
      "Sample similarity cannot prove correct biological labels, independence, batch correction or absence of contamination.",
      "No differential expression, p-values, FDR, DESeq2/edgeR, transcript-length offsets or quantification of raw reads was performed.",
      "Source FASTQ bytes, matching Salmon index, reference genome and annotation provenance remain independently unverified."
    ],
    source_fastq_verified:false,reference_verified:false,differential_expression_performed:false
  };
}
