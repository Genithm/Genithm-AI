/** Genithm V72: structural GTF transcript-to-gene map derivation.
 *
 * All parsing and data stay local in the browser. Reference and assembly
 * identity are NOT proven just because a GTF parses successfully. There is
 * no attempt to resolve identifier versions, splice-isoform length offsets,
 * coordinate overlap, gene naming, or differential-expression evidence.
 */

export const GENITHM_GTF_MAPPING_SCHEMA = "genithm-gtf-transcript-map/1";
export const MAX_GTF_BYTES = 32 * 1024 * 1024;
export const MAX_GTF_FEATURES = 400000;
export const MAX_GTF_TRANSCRIPTS = 150000;
export const MAX_GTF_LINE_CHARS = 8192;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:|\-]{0,253}$/;
const SAFE_SEQID = /^[A-Za-z0-9][A-Za-z0-9_.:|\-]{0,253}$/;
const SAFE_FEATURE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const NUMBER = /^[1-9][0-9]*$/;

export type GtfMapping = {
  schema:typeof GENITHM_GTF_MAPPING_SCHEMA;
  status:"structural_gtf_mapping_only";
  source_feature_rows:number;
  transcript_features:number;
  exon_features:number;
  cds_features:number;
  transcript_ids:number;
  gene_ids:number;
  multi_transcript_genes:number;
  contigs_seen:number;
  transcript_to_gene_tsv:string;
  warnings:string[];
  assembly_verified:false;
  salmon_index_verified:false;
  annotation_biology_verified:false;
};
export class GtfMappingError extends Error {
  readonly code:string;
  constructor(code:string,message:string){super(message);this.name="GtfMappingError";this.code=code;}
}
function fail(code:string,detail:string):never{throw new GtfMappingError(code,detail);}

/** Parses mandatory GTF quoted attribute values, including unrelated free-text
 * fields with safely escaped quotes/semicolons, but never interprets names.
 */
function attributes(source:string,line:number):{gene?:string;transcript?:string}{
  let p=0,gene:string|undefined,transcript:string|undefined;
  const seen=new Set<string>();
  while(p<source.length){
    while(source[p]===" " || source[p]==="\t")p++;
    if(p>=source.length)break;
    const start=p;
    while(p<source.length && /[A-Za-z0-9_]/.test(source[p]))p++;
    const key=source.slice(start,p);
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))
      fail("attributes",`GTF line ${line}: invalid attribute key.`);
    if(p===source.length || (source[p]!==" " && source[p]!=="\t"))
      fail("attributes",`GTF line ${line}: expected a quoted GTF attribute.`);
    while(source[p]===" " || source[p]==="\t")p++;
    let value="";
    if(source[p]==='"'){
      p++;
      let closed=false;
      for(;p<source.length;p++){
        const ch=source[p];
        if(ch==='"'){closed=true;p++;break;}
        if(ch==='\\'){
          if(++p>=source.length)fail("attributes",`GTF line ${line}: unterminated escape.`);
          value+=source[p];
        }else{value+=ch;}
        if(value.length>1024)fail("limit",`GTF line ${line}: attribute too long.`);
      }
      if(!closed)fail("attributes",`GTF line ${line}: unterminated quoted value.`);
    }else{
      // Some GTF producers emit unquoted exon_number / numeric metadata.
      // gene_id and transcript_id always require quoted exact identifiers.
      if(key==="gene_id" || key==="transcript_id")
        fail("attributes",`GTF line ${line}: ${key} must be quoted.`);
      const first=p;
      while(p<source.length && source[p]!==";")p++;
      value=source.slice(first,p).trim();
      if(!/^[A-Za-z0-9_.-]{1,128}$/.test(value))
        fail("attributes",`GTF line ${line}: unsupported unquoted metadata.`);
    }
    while(source[p]===" " || source[p]==="\t")p++;
    if(p<source.length){
      if(source[p]!==";")fail("attributes",`GTF line ${line}: expected semicolon delimiter.`);
      p++;
    }
    if(key==="gene_id" || key==="transcript_id"){
      if(seen.has(key))fail("ambiguous",`GTF line ${line}: repeated ${key}.`);
      seen.add(key);
      if(!SAFE_ID.test(value))fail("identifier",`GTF line ${line}: unsafe ${key}.`);
      if(key==="gene_id")gene=value;else transcript=value;
    }
  }
  return {gene,transcript};
}

export function deriveTx2GeneFromGtf(text:string):GtfMapping{
  if(typeof text!=="string"||!text.trim())fail("empty","GTF must not be empty.");
  if(new TextEncoder().encode(text).byteLength>MAX_GTF_BYTES)
    fail("size","GTF exceeds the 32 MiB local parsing limit.");
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))
    fail("control","GTF contains prohibited control characters.");
  const source=text.replace(/^\uFEFF/,"");
  const transcripts=new Map<string,{gene:string;seqid:string;strand:string}>();
  const geneCount=new Map<string,number>();
  const contigs=new Set<string>();
  let rows=0,exons=0,cds=0,transcriptRows=0;
  const lines=source.split("\n");
  for(let i=0;i<lines.length;i++){
    let line=lines[i];
    if(line.endsWith("\r"))line=line.slice(0,-1);
    if(!line.trim() || line.startsWith("#"))continue;
    if(line.includes("\r"))fail("control",`GTF line ${i+1} contains an embedded carriage return.`);
    const lineNo=i+1;
    if(line.length>MAX_GTF_LINE_CHARS)fail("limit",`GTF line ${lineNo} exceeds 8,192 characters.`);
    const cols=line.split("\t");
    if(cols.length!==9)fail("columns",`GTF line ${lineNo} requires exactly nine tab-separated columns.`);
    const [seqid,sourceName,feature,startText,endText,score,strand,frame,attr]=cols;
    if(!SAFE_SEQID.test(seqid) || !SAFE_FEATURE.test(feature) ||
       !sourceName || sourceName.length>254 || /[\s\r\n;=]/.test(sourceName) ||
       !NUMBER.test(startText) || !NUMBER.test(endText) ||
       !["+","-","."].includes(strand) || !["0","1","2","."].includes(frame))
      fail("feature",`GTF line ${lineNo} has invalid feature fields.`);
    const start=Number(startText),end=Number(endText);
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end<start)
      fail("coordinates",`GTF line ${lineNo} has invalid one-based genomic coordinates.`);
    if(score!=="."){
      if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(score) ||
         !Number.isFinite(Number(score)))
        fail("score",`GTF line ${lineNo} has invalid score.`);
    }
    const {gene,transcript}=attributes(attr,lineNo);
    if(!gene)fail("identifier",`GTF line ${lineNo} requires gene_id.`);
    if(feature==="transcript" || feature==="exon" || feature==="CDS"){
      if(!transcript)fail("identifier",`GTF line ${lineNo} requires transcript_id for ${feature}.`);
    }
    rows++;
    if(rows>MAX_GTF_FEATURES)fail("limit","GTF feature rows exceed 400,000.");
    contigs.add(seqid);
    if(contigs.size>100000)fail("limit","GTF contains too many distinct contigs.");
    if(feature==="transcript")transcriptRows++;
    if(feature==="exon")exons++;
    if(feature==="CDS")cds++;
    if(transcript){
      const prior=transcripts.get(transcript);
      if(prior){
        if(prior.gene!==gene || prior.seqid!==seqid ||
           (prior.strand!=="." && strand!=="." && prior.strand!==strand))
          fail("ambiguous",`GTF line ${lineNo}: conflicting transcript-to-gene assignment or locus.`);
        if(prior.strand==="." && strand!==".")prior.strand=strand;
      }else{
        transcripts.set(transcript,{gene,seqid,strand});
        geneCount.set(gene,(geneCount.get(gene)??0)+1);
        if(transcripts.size>MAX_GTF_TRANSCRIPTS)
          fail("limit","GTF has more than 150,000 distinct transcript IDs.");
      }
    }
  }
  if(rows===0 || transcripts.size===0)
    fail("empty","GTF has no usable gene/transcript relationships.");
  const ordered=[...transcripts].sort(([a],[b])=>a.localeCompare(b,"en"));
  const tsv="transcript_id\tgene_id\n"+ordered.map(([tx,{gene}])=>`${tx}\t${gene}\n`).join("");
  if(new TextEncoder().encode(tsv).byteLength>8*1024*1024)
    fail("limit","Derived transcript-to-gene mapping exceeds the 8 MiB V71 input bound.");
  // All output values came from strictly validated, unique IDs above.
  return {
    schema:GENITHM_GTF_MAPPING_SCHEMA,status:"structural_gtf_mapping_only",
    source_feature_rows:rows,transcript_features:transcriptRows,exon_features:exons,
    cds_features:cds,transcript_ids:transcripts.size,gene_ids:geneCount.size,
    multi_transcript_genes:[...geneCount.values()].filter(v=>v>1).length,
    contigs_seen:contigs.size,transcript_to_gene_tsv:tsv,
    warnings:[
      "GTF transcript and gene identifiers were parsed structurally. Gene assignments and genomic assembly accuracy are not independently verified.",
      "One transcript must belong to exactly one gene and locus. Duplicate exon rows are not deduplicated or treated as expression evidence.",
      "This mapping does not establish that a Salmon index used the same transcriptome. Transcript version suffixes must match exactly.",
      "No FASTQ files, variant coordinates, differential expression, transcript length offsets or gene quantification were computed by the GTF parser."
    ],
    assembly_verified:false,salmon_index_verified:false,annotation_biology_verified:false
  };
}
