/** V70: real local interrogation of Salmon quant.sf, not running Salmon.
 * Import only the five documented Salmon quant.sf columns and form an exact
 * transcript-ID joined TPM/estimated-fragment matrix. Never label NumReads
 * integer raw gene counts, gene-level DE or verified source reads.
 */
export const SALMON_IMPORT_SCHEMA="genithm-salmon-transcript-matrix/1";
export const MAX_SALMON_SAMPLES=24;
export const MAX_SALMON_QUANT_BYTES=24*1024*1024;
export const MAX_SALMON_TRANSCRIPTS=100000;
export const MAX_SALMON_MATRIX_CELLS=1000000;
export type SalmonInput={sample:string;text:string};
export type SalmonSampleStats={
  sample:string;transcripts:number;expressed_transcripts:number;
  total_reported_tpm:number;total_estimated_fragments:number;effective_length_zero:number;
};
export type SalmonMatrix={
  schema:typeof SALMON_IMPORT_SCHEMA;
  status:"imported_quantification_outputs_only";
  samples:number;transcripts:number;
  sample_stats:SalmonSampleStats[];
  transcript_tpm_tsv:string;
  transcript_estimated_fragments_tsv:string;
  summary_tsv:string;
  warnings:string[];
  quantification_performed_by_genithm:false;
  differential_expression_performed:false;
  raw_reads_inspected:false;
  reference_provenance_verified:false;
};
export class SalmonQuantImportError extends Error{
  readonly code:string;
  constructor(code:string,detail:string){super(detail);this.code=code;this.name="SalmonQuantImportError";}
}
const reject=(code:string,detail:string):never=>{throw new SalmonQuantImportError(code,detail);};
const SAMPLE=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const TRANSCRIPT=/^[A-Za-z0-9][A-Za-z0-9_.|:-]{0,253}$/;
const NUMBER=/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const HEADER="Name\tLength\tEffectiveLength\tTPM\tNumReads";
type QuantRow={length:number;tpm:number;estimated:number;effectiveZero:boolean};
function parseQuant(sample:SalmonInput):{rows:Map<string,QuantRow>;stats:SalmonSampleStats}{
  if(!SAMPLE.test(sample.sample))reject("sample","Invalid Salmon sample identifier.");
  if(typeof sample.text!=="string"||!sample.text.trim())
    reject("empty","Salmon "+sample.sample+": quant.sf is empty.");
  if(new TextEncoder().encode(sample.text).length>MAX_SALMON_QUANT_BYTES)
    reject("size","Salmon "+sample.sample+": quant.sf exceeds 24 MiB.");
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(sample.text))
    reject("control","Salmon "+sample.sample+": file contains a prohibited control character.");
  const lines=sample.text.replace(/^\uFEFF/,"").split(/\r?\n/);
  if(lines[0]!==HEADER)reject("header","Salmon "+sample.sample+": expected exact quant.sf header.");
  const rows=new Map<string,QuantRow>();
  let tpmSum=0,estimatedSum=0,expressed=0,zero=0;
  for(let index=1;index<lines.length;index++){
    const line=lines[index];
    if(line==="" && index===lines.length-1)continue;
    if(!line || line.includes("\r"))reject("line","Salmon "+sample.sample+": invalid blank or carriage-return line.");
    const cols=line.split("\t");
    if(cols.length!==5)reject("columns","Salmon "+sample.sample+": expected five tab-separated columns.");
    const [name,length,eff,tpm,estimated]=cols;
    if(!TRANSCRIPT.test(name))reject("transcript","Salmon "+sample.sample+": invalid transcript identifier.");
    if(rows.has(name))reject("duplicate","Salmon "+sample.sample+": duplicate transcript identifier.");
    if(!/^[1-9][0-9]*$/.test(length))
      reject("length","Salmon "+sample.sample+": transcript length must be a positive integer.");
    if(![eff,tpm,estimated].every(s=>NUMBER.test(s)))
      reject("number","Salmon "+sample.sample+": nonnumeric quantification field.");
    const l=Number(length),el=Number(eff),tp=Number(tpm),nr=Number(estimated);
    if(![l,el,tp,nr].every(Number.isFinite)||
       !Number.isSafeInteger(l)||l>1000000000||el<0||el>l+0.001||
       tp<0||tp>1000000||nr<0||nr>1e12)
      reject("range","Salmon "+sample.sample+": invalid length, TPM or estimated-fragment range.");
    rows.set(name,{length:l,tpm:tp,estimated:nr,effectiveZero:el===0});
    tpmSum+=tp;estimatedSum+=nr;
    if(nr>0)expressed++;
    if(el===0)zero++;
    if(rows.size>MAX_SALMON_TRANSCRIPTS)reject("transcripts","Salmon transcript count exceeds 100,000.");
  }
  if(!rows.size)reject("empty","Salmon "+sample.sample+": no transcript records.");
  if(!Number.isFinite(tpmSum)||!Number.isFinite(estimatedSum)||estimatedSum>1e14)
    reject("total","Salmon "+sample.sample+": invalid total quantification.");
  // Salmon should normalize nonzero TPM values to approximately 1 million.
  // Float text rounding and filter outputs warrant a small tolerance.
  if((estimatedSum>0 && Math.abs(tpmSum-1000000)>5000)||
     (estimatedSum===0 && Math.abs(tpmSum)>0.0001))
    reject("tpm","Salmon "+sample.sample+": reported TPM totals are inconsistent.");
  return {rows,stats:{
    sample:sample.sample,transcripts:rows.size,expressed_transcripts:expressed,
    total_reported_tpm:Number(tpmSum.toFixed(6)),
    total_estimated_fragments:Number(estimatedSum.toFixed(6)),
    effective_length_zero:zero
  }};
}
function tsvNumber(n:number):string {return Number.isFinite(n)?String(n):"NA";}
export function inspectSalmonQuantifications(inputs:SalmonInput[]):SalmonMatrix{
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>MAX_SALMON_SAMPLES)
    reject("samples","Choose between one and twenty-four Salmon samples.");
  const ids=new Set<string>();
  for(const x of inputs){
    if(!x||typeof x!=="object"||typeof x.sample!=="string"||ids.has(x.sample))
      reject("sample","Salmon sample identifiers must be unique.");
    ids.add(x.sample);
  }
  const parsed=inputs.map(parseQuant);
  const primary=parsed[0].rows;
  if(primary.size*inputs.length>MAX_SALMON_MATRIX_CELLS)
    reject("cells","Transcript-by-sample matrix exceeds the one-million-cell limit.");
  for(const p of parsed.slice(1)){
    if(p.rows.size!==primary.size)reject("reference","Salmon transcript set is inconsistent across samples.");
    for(const [key,ref] of primary){
      const got=p.rows.get(key);
      if(!got||got.length!==ref.length)
        reject("reference","Salmon transcript identities/lengths are inconsistent across samples.");
    }
  }
  const header="transcript_id\t"+inputs.map(x=>x.sample).join("\t")+"\n";
  const tpm=[header],fragment=[header];
  for(const key of primary.keys()){
    tpm.push(key+"\t"+parsed.map(p=>tsvNumber(p.rows.get(key)!.tpm)).join("\t")+"\n");
    fragment.push(key+"\t"+parsed.map(p=>tsvNumber(p.rows.get(key)!.estimated)).join("\t")+"\n");
  }
  const stats=parsed.map(p=>p.stats);
  const summary=["sample\ttranscripts\texpressed_transcripts\ttotal_reported_tpm\ttotal_estimated_fragments\teffective_length_zero\n"];
  for(const s of stats)
    summary.push([s.sample,s.transcripts,s.expressed_transcripts,s.total_reported_tpm,
      s.total_estimated_fragments,s.effective_length_zero].join("\t")+"\n");
  return {
    schema:SALMON_IMPORT_SCHEMA,status:"imported_quantification_outputs_only",
    samples:inputs.length,transcripts:primary.size,sample_stats:stats,
    transcript_tpm_tsv:tpm.join(""),
    transcript_estimated_fragments_tsv:fragment.join(""),
    summary_tsv:summary.join(""),
    warnings:[
      "Imported existing Salmon quant.sf output: Genithm did not align reads, build an index, quantify transcripts, or inspect FASTQ source bytes.",
      "NumReads is Salmon's estimated transcript-level fragment abundance and may be fractional; it is not raw integer gene counts. Do not pass it directly to Genithm's existing raw-count expression test.",
      "Matching transcript IDs and lengths is not proof of matching reference builds, indexing options, library protocols, mapping quality or sample provenance.",
      "Transcript TPM is not comparable to raw gene counts and does not establish differential expression, clinical significance or pathway enrichment."
    ],
    quantification_performed_by_genithm:false,differential_expression_performed:false,
    raw_reads_inspected:false,reference_provenance_verified:false
  };
}
