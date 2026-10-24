/**
 * V55 research-file attachments: deterministic browser-side inspection only.
 * Raw files stay in the browser. Reports contain bounded, numeric aggregates;
 * no client report can authorize a scientific server job or a private file read.
 */
export const CHAT_FILE_COMPLETE_SCAN_BYTES = 8 * 1024 * 1024;
export const CHAT_FILE_HEADER_BYTES = 64 * 1024;
export const CHAT_FILE_LIMIT = 10;
export const CHAT_EXCERPT_BYTES = 1500;

export const CHAT_FORMATS = [
  "fasta", "fastq", "vcf", "csv", "tsv", "bed", "gff", "sam", "pdb", "newick", "json", "text",
  "pdf", "docx", "xlsx", "zip", "gzip", "bam", "cram", "bcf", "hdf5", "parquet", "rds",
  "mzml", "pod5", "binary", "unknown",
] as const;
export type ChatFileFormat = typeof CHAT_FORMATS[number];
export type ChatFileInspection = "complete" | "header_only" | "opaque" | "invalid";
export type ChatFileEvidence = {
  filename: string;
  size_bytes: number;
  format: ChatFileFormat;
  inspection: ChatFileInspection;
  sha256: string | null;
  metrics: Record<string, number>;
  excerpt?: string;
};

// Intentionally no PII-bearing sample IDs, variant IDs, allele strings or paths.
const METRICS = new Set([
  "records", "bases", "min_length", "max_length", "reads", "q30_bases", "total_quality_bases",
  "gc_bases", "variants", "samples", "snvs", "indels", "passed_filters", "biallelic",
  "rows", "columns", "numeric_columns", "missing_cells", "intervals", "covered_bp",
  "features", "alignments", "mapped", "unmapped", "atoms", "models", "lines", "characters",
  "object_keys", "array_items", "leaves",
]);
const FMT = new Set<string>(CHAT_FORMATS);
const INSPECTIONS = new Set<ChatFileInspection>(["complete", "header_only", "opaque", "invalid"]);
const TEXT_FORMATS = new Set<ChatFileFormat>(["fasta", "fastq", "vcf", "csv", "tsv", "bed", "gff", "sam", "pdb", "newick", "json", "text"]);
const RESEARCH_PREVIEW_FORMATS = new Set<ChatFileFormat>(["csv", "tsv", "json", "text", "pdb", "newick"]);
const SHA = /^[0-9a-f]{64}$/;

export function isChatTextExcerptFormat(format: ChatFileFormat): boolean {
  return RESEARCH_PREVIEW_FORMATS.has(format);
}
export function validateChatFileEvidence(input: unknown): ChatFileEvidence[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > CHAT_FILE_LIMIT) throw new Error("Invalid local research-file attachment list.");
  const results: ChatFileEvidence[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid local research-file attachment.");
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some(key => !["filename", "size_bytes", "format", "inspection", "sha256", "metrics", "excerpt"].includes(key)))
      throw new Error("Unexpected local research-file evidence field.");
    if (typeof value.filename !== "string" || !value.filename.trim() || value.filename.length > 180 ||
        /[\x00-\x1f\x7f]/.test(value.filename) ||
        !Number.isSafeInteger(value.size_bytes) || (value.size_bytes as number) < 1 ||
        !FMT.has(String(value.format)) || !INSPECTIONS.has(value.inspection as ChatFileInspection))
      throw new Error("Invalid local research-file metadata.");
    if (value.sha256 !== null && (typeof value.sha256 !== "string" || !SHA.test(value.sha256)))
      throw new Error("Invalid local research-file digest.");
    if (value.inspection !== "complete" && value.sha256 !== null) throw new Error("Partial local inspection cannot assert a full-source digest.");
    if (value.inspection === "complete" && (value.size_bytes as number) > CHAT_FILE_COMPLETE_SCAN_BYTES)
      throw new Error("Local report exceeds full-inspection limit.");
    if (value.inspection === "complete" && !TEXT_FORMATS.has(value.format as ChatFileFormat))
      throw new Error("Binary file cannot claim complete biological inspection.");
    if (!value.metrics || typeof value.metrics !== "object" || Array.isArray(value.metrics))
      throw new Error("Invalid local research-file metrics.");
    const metrics: Record<string, number> = {};
    const sourceMetrics = value.metrics as Record<string, unknown>;
    if (Object.keys(sourceMetrics).length > 24) throw new Error("Excessive local research-file metrics.");
    for (const [name, n] of Object.entries(sourceMetrics)) {
      if (!METRICS.has(name) || typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000_000)
        throw new Error("Invalid local research-file metric.");
      metrics[name] = n;
    }
    if (value.inspection !== "complete" && Object.keys(metrics).length) throw new Error("Partial file cannot assert full-file counts.");
    if (value.excerpt !== undefined && (
      typeof value.excerpt !== "string" || value.excerpt.length > CHAT_EXCERPT_BYTES ||
      !isChatTextExcerptFormat(value.format as ChatFileFormat) || value.inspection !== "complete" ||
      /\u0000/.test(value.excerpt)
    )) throw new Error("Invalid local research-file excerpt.");
    results.push({
      filename: value.filename.trim(), size_bytes: value.size_bytes as number,
      format: value.format as ChatFileFormat, inspection: value.inspection as ChatFileInspection,
      sha256: value.sha256 as string | null, metrics,
      ...(value.excerpt === undefined ? {} : { excerpt: value.excerpt as string }),
    });
  }
  return results;
}

/** Create a safe, marked *client-reported* context: never present it as verified server evidence. */
export function safeChatFileContext(files: ChatFileEvidence[], shareExcerpts: boolean) {
  return files.map(file => ({
    source: "unverified_browser_inspection_not_a_server_job",
    filename: file.filename, size_bytes: file.size_bytes, format_hint: file.format,
    inspection: file.inspection, file_sha256_if_fully_read: file.sha256,
    counts_if_complete: file.inspection === "complete" ? file.metrics : {},
    ...(shareExcerpts && file.excerpt !== undefined ? { user_approved_text_excerpt: file.excerpt } : {}),
    limitations: file.inspection === "complete"
      ? "Locally inspected selected file format only; not a domain-wide scientific analysis, clinical result or authorized backend resource."
      : "File accepted as a local attachment but content not fully parsed; no scientific result may be inferred.",
  }));
}

function extension(filename: string): string {
  return filename.split(".").at(-1)?.toLowerCase() || "";
}
function starts(bytes: Uint8Array, hex: number[]): boolean {
  return bytes.length >= hex.length && hex.every((byte, i) => bytes[i] === byte);
}
function safeLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}
function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}
function classify(filename: string, bytes: Uint8Array, text: string | null): ChatFileFormat {
  const ext = extension(filename);
  const n = filename.toLowerCase();
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (starts(bytes, [0x42, 0x41, 0x4d, 0x01]) || ext === "bam") return "bam";
  if (starts(bytes, [0x43, 0x52, 0x41, 0x4d]) || ext === "cram") return "cram";
  if (starts(bytes, [0x42, 0x43, 0x46, 0x02]) || ext === "bcf") return "bcf";
  if (starts(bytes, [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]) || ["h5", "h5ad", "hdf5", "loom"].includes(ext)) return "hdf5";
  if (starts(bytes, [0x50, 0x41, 0x52, 0x31]) || ext === "parquet") return "parquet";
  if (starts(bytes, [0x1f, 0x8b])) return "gzip";
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) || starts(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    if (ext === "docx") return "docx";
    if (ext === "xlsx") return "xlsx";
    return "zip";
  }
  if (["pod5"].includes(ext)) return "pod5";
  if (["mzml", "mzxml"].includes(ext)) return "mzml";
  if (["rds", "rdata", "rda"].includes(ext)) return "rds";
  if (text === null) return "binary";
  const beginning = text.replace(/^\uFEFF/, "").trimStart();
  if (beginning.startsWith("##fileformat=VCFv4.")) return "vcf";
  if (beginning.startsWith(">") && /^(?:>|\uFEFF>)[^\n\r]+\r?\n/.test(text)) return "fasta";
  if (beginning.startsWith("@") && /^@[^\n]+\r?\n[^\n]*\r?\n\+/.test(beginning)) return "fastq";
  if (/^\s*[\[{]/.test(beginning) && ["json", "ipynb", "geojson"].includes(ext)) return "json";
  if (n.endsWith(".vcf") || ext === "vcf") return "vcf";
  if (["fasta", "fa", "faa", "fna", "fas", "fsa", "ffn", "frn"].includes(ext)) return beginning.startsWith(">") ? "fasta" : "text";
  if (["fastq", "fq"].includes(ext)) return "fastq";
  if (["gff", "gff3", "gtf"].includes(ext)) return "gff";
  if (ext === "bed") return "bed";
  if (ext === "sam") return "sam";
  if (ext === "pdb") return "pdb";
  if (["nwk", "newick", "tree", "tre"].includes(ext)) return "newick";
  if (["json", "ipynb", "geojson"].includes(ext)) return "json";
  if (["tsv", "tab"].includes(ext)) return "tsv";
  if (ext === "csv") return "csv";
  if (["txt", "md", "log", "py", "r", "sh", "js", "ts", "yaml", "yml", "xml", "html", "sql", "pdf.txt"].includes(ext)) return "text";
  if (beginning.startsWith("##gff-version")) return "gff";
  if (/^@(?:HD|SQ|RG|PG)\t/.test(beginning)) return "sam";
  if (/\t/.test(beginning.split("\n", 1)[0]) && beginning.includes("\n")) return "tsv";
  if (/,/.test(beginning.split("\n", 1)[0]) && beginning.includes("\n")) return "csv";
  return "text";
}

function inspectFasta(text: string): Record<string, number> {
  const lines = safeLines(text); let records = 0, bases = 0, len = 0;
  let min = Number.MAX_SAFE_INTEGER, max = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      if (!line.slice(1).trim()) throw new Error("FASTA header missing");
      if (records) { min = Math.min(min, len); max = Math.max(max, len); }
      records++; len = 0;
    } else {
      if (!records || !/^[A-Za-z*.-]+$/.test(line)) throw new Error("Invalid FASTA records");
      len += line.length; bases += line.length;
    }
  }
  if (!records || !bases || !len) throw new Error("Empty FASTA sequence");
  return { records, bases, min_length: Math.min(min, len), max_length: Math.max(max, len) };
}
function inspectFastq(text: string): Record<string, number> {
  const lines = safeLines(text); if (!lines.length || lines.length % 4 !== 0) throw new Error("Unsupported FASTQ dialect");
  let bases = 0, q30 = 0, gc = 0, min = Number.MAX_SAFE_INTEGER, max = 0;
  for (let i=0;i<lines.length;i+=4) {
    const [name, seq, plus, qual] = lines.slice(i, i+4);
    if (!name.startsWith("@") || name.length < 2 || !plus.startsWith("+") || !/^[A-Za-z.]+$/.test(seq) || seq.length !== qual.length)
      throw new Error("Invalid four-line FASTQ read");
    for (let j=0;j<qual.length;j++) {
      const phred = qual.charCodeAt(j) - 33;
      if (phred < 0 || phred > 93) throw new Error("Invalid Phred+33 encoding");
      if (phred >= 30) q30++;
    }
    bases += seq.length; gc += countMatches(seq, /[gc]/gi);
    min = Math.min(min, seq.length); max = Math.max(max, seq.length);
  }
  return {reads: lines.length / 4, bases, q30_bases: q30, total_quality_bases: bases, gc_bases: gc, min_length: min, max_length: max};
}
function inspectVcf(text: string): Record<string, number> {
  const lines = safeLines(text);if (!lines[0].startsWith("##fileformat=VCFv4.")) throw new Error("Not a VCF v4 file");
  let header=false, variants=0,snvs=0,indels=0,pass=0,biallelic=0,samples=0;
  for (const line of lines) {
    if (!line || line.startsWith("##")) continue;
    if (line.startsWith("#CHROM\t")) {
      if (header) throw new Error("Duplicate VCF header");
      const columns=line.split("\t");if(columns.length<8)throw new Error("Invalid VCF header");
      samples=Math.max(0,columns.length-9);header=true;continue;
    }
    if (!header || line.startsWith("#")) throw new Error("Invalid VCF row");
    const cells=line.split("\t");if(cells.length<8 || !Number.isSafeInteger(Number(cells[1])) || Number(cells[1])<1 ||
      (samples && cells.length !== 9+samples)) throw new Error("Invalid VCF fields");
    variants++;
    if (cells[4] !== "." && !cells[4].includes(",")) {
      biallelic++;
      if(cells[3].length===1 && cells[4].length===1)snvs++;
      else if(cells[3].length !== cells[4].length)indels++;
    }
    if(cells[6]==="PASS" || cells[6]===".")pass++;
  }
  if (!header) throw new Error("Missing VCF header");
  return { variants, samples, snvs, indels, passed_filters:pass, biallelic };
}

/** RFC4180-style CSV with quoting; TSV uses tabs. Whole-file only, bounded by 8 MiB. */
function parseTable(text: string, separator: "," | "\t"): string[][] {
  const rows: string[][] = [];let field="",row:string[]=[],quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted && text[i+1]==='"'){field+='"';i++;}
      else if(quoted){quoted=false;}
      else if(!field){quoted=true;}
      else throw new Error("Malformed table quotes");
    }else if(ch===separator&&!quoted){row.push(field);field="";}
    else if((ch==="\n"||ch==="\r")&&!quoted){
      if(ch==="\r"&&text[i+1]==="\n")i++;
      row.push(field);field="";if(row.some(x=>x!==""))rows.push(row);row=[];
    }else{field+=ch;}
  }
  if(quoted)throw new Error("Unclosed table quote");
  row.push(field);if(row.some(x=>x!==""))rows.push(row);
  return rows;
}
function inspectTable(text:string,delimiter:","|"\t"):Record<string,number>{
  const rows=parseTable(text.replace(/^\uFEFF/,""),delimiter);
  if(!rows.length || rows[0].length<1)throw new Error("Empty data table");
  const cols=rows[0].length;
  if(cols>100000 || rows.some(row=>row.length!==cols))throw new Error("Unequal table columns");
  let missing=0,numeric=0;
  for(let col=0;col<cols;col++){
    let allNumeric=rows.length>1, observed=0;
    for(let i=1;i<rows.length;i++){
      const v=rows[i][col].trim();if(!v||/^(?:NA|N\/A|null|nan|\.)$/i.test(v)){missing++;continue;}
      observed++;if(!Number.isFinite(Number(v)))allNumeric=false;
    }
    if(allNumeric&&observed>0)numeric++;
  }
  return {rows:Math.max(0,rows.length-1),columns:cols,numeric_columns:numeric,missing_cells:missing};
}
function inspectBed(text:string):Record<string,number>{
  let intervals=0,covered=0;
  for(const line of safeLines(text)){
    if(!line||line.startsWith("#")||line.startsWith("track")||line.startsWith("browser"))continue;
    const parts=line.split("\t");const s=Number(parts[1]),e=Number(parts[2]);
    if(parts.length<3||!parts[0]||!Number.isSafeInteger(s)||!Number.isSafeInteger(e)||s<0||e<=s)throw new Error("Invalid BED interval");
    intervals++;covered+=e-s;
  }
  return {intervals,covered_bp:covered};
}
function inspectGff(text:string):Record<string,number>{
  let features=0;for(const line of safeLines(text)){
    if(!line||line.startsWith("#"))continue;
    const cells=line.split("\t");const s=Number(cells[3]),e=Number(cells[4]);
    if(cells.length!==9||!Number.isSafeInteger(s)||!Number.isSafeInteger(e)||s<1||e<s)throw new Error("Invalid GFF/GTF record");
    features++;
  }
  return {features};
}
function inspectSam(text:string):Record<string,number>{
  let alignments=0,mapped=0,unmapped=0;
  for(const line of safeLines(text)){
    if(!line||line.startsWith("@"))continue;
    const parts=line.split("\t");const flag=Number(parts[1]);
    if(parts.length<11||!Number.isSafeInteger(flag)||flag<0)throw new Error("Invalid SAM alignment");
    alignments++;if((flag&4)!==0)unmapped++;else mapped++;
  }
  return {alignments,mapped,unmapped};
}
function inspectPdb(text:string):Record<string,number>{
  let atoms=0,models=0;for(const line of safeLines(text)){
    if(line.startsWith("ATOM  ")||line.startsWith("HETATM"))atoms++;
    else if(line.startsWith("MODEL "))models++;
  }
  if(!atoms)throw new Error("No PDB atoms");
  return {atoms,models:Math.max(1,models)};
}
function inspectNewick(text:string):Record<string,number>{
  const s=text.trim();if(!s.startsWith("(")||!s.endsWith(";")||/[<>]/.test(s))throw new Error("Invalid Newick outline");
  let depth=0,leaves=0;let token="";
  for(const ch of s){
    if(ch==="("){depth++;token="";}
    else if(ch===","){if(token.trim()&&!token.trim().startsWith(":"))leaves++;token="";}
    else if(ch===")"){if(token.trim()&&!token.trim().startsWith(":"))leaves++;token="";depth--;if(depth<0)throw new Error("Unbalanced Newick");}
    else if(ch===";"){}else{token+=ch;}
  }
  if(depth!==0||leaves<2)throw new Error("Incomplete Newick tree");
  return {leaves};
}
function inspectJson(text:string):Record<string,number>{
  const parsed:unknown=JSON.parse(text);
  if(Array.isArray(parsed))return {array_items:parsed.length};
  if(parsed&&typeof parsed==="object")return {object_keys:Object.keys(parsed).length};
  return {characters:text.length};
}
function inspectText(text:string):Record<string,number>{return {lines:safeLines(text).length,characters:text.length};}

/** Pure, testable core. `complete=false` never reports whole-file scientific counts. */
export function inspectChatFileBytes(filename:string,size_bytes:number,bytes:Uint8Array,complete:boolean):ChatFileEvidence{
  if(!filename.trim()||size_bytes<1||bytes.length<1)throw new Error("Choose a nonempty file.");
  let text:string|null=null;
  try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes,{stream:!complete});if(text.includes("\u0000"))text=null;}
  catch{text=null;}
  const format=classify(filename,bytes,text);
  const base:ChatFileEvidence={filename:filename.slice(0,180),size_bytes,format,inspection:"opaque",sha256:null,metrics:{}};
  if(!TEXT_FORMATS.has(format)||text===null)return base;
  if(!complete)return {...base,inspection:"header_only"};
  try{
    const metrics=format==="fasta"?inspectFasta(text):format==="fastq"?inspectFastq(text):
      format==="vcf"?inspectVcf(text):format==="csv"?inspectTable(text,","):
      format==="tsv"?inspectTable(text,"\t"):format==="bed"?inspectBed(text):
      format==="gff"?inspectGff(text):format==="sam"?inspectSam(text):
      format==="pdb"?inspectPdb(text):format==="newick"?inspectNewick(text):
      format==="json"?inspectJson(text):inspectText(text);
    const evidence:ChatFileEvidence={...base,inspection:"complete",metrics};
    if(isChatTextExcerptFormat(format))evidence.excerpt=text.slice(0,CHAT_EXCERPT_BYTES);
    return evidence;
  }catch{return {...base,inspection:"invalid"};}
}

/** Browser entrypoint. Large/proprietary files are accepted as opaque, not falsely parsed. */
export async function inspectChatFile(file:File):Promise<ChatFileEvidence>{
  if(!Number.isSafeInteger(file.size)||file.size===0)throw new Error("Choose a nonempty file.");
  const full=file.size<=CHAT_FILE_COMPLETE_SCAN_BYTES;
  const bytes=new Uint8Array(await file.slice(0,full?file.size:CHAT_FILE_HEADER_BYTES).arrayBuffer());
  const inspection=inspectChatFileBytes(file.name,file.size,bytes,full);
  if(inspection.inspection==="complete"){
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    inspection.sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
  }
  return validateChatFileEvidence([inspection])[0];
}

export async function isActualFasta(file:File):Promise<boolean>{
  const ext=extension(file.name);
  if(!["fasta","fa","fna","faa","fas","txt"].includes(ext))return false;
  const prefix=await file.slice(0,8192).text();
  return prefix.replace(/^\uFEFF/,"").trimStart().startsWith(">");
}
