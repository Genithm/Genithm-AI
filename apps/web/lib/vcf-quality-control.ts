/**
 * Genithm V38: private, deterministic VCF v4 quality-control inspection.
 * The raw file never leaves the browser. Clinical interpretation, variant
 * pathogenicity, annotation and variant calling are NOT performed.
 */
export const VCF_QC_VERSION = "genithm-vcf-qc/1.0.0";
export const MAX_VCF_BYTES = 8 * 1024 * 1024;
export const MAX_VCF_RECORDS = 50000;
export const MAX_VCF_PREVIEW = 80;

export const VARIANT_CATEGORIES = ["SNV", "MNV", "insertion", "deletion", "complex", "multiallelic"] as const;
export type VariantCategory = typeof VARIANT_CATEGORIES[number];
export type VcfPreview = {
  chrom: string; pos: number; ref: string; alt: string;
  qual: number | null; filter: string; category: VariantCategory;
};
export type VcfQcSummary = {
  schema: "genithm-vcf-qc-summary/1";
  analyzerVersion: typeof VCF_QC_VERSION;
  totalRecords: number;
  sampleColumns: number;
  variantCounts: Record<VariantCategory, number>;
  filterCounts: { pass: number; filtered: number; missing: number };
  qualityBins: number[];
  missingQual: number;
  transitions: number;
  transversions: number;
  chromCounts: { chrom: string; count: number }[];
  distinctChromosomes: number;
};
export type VcfQcResult = { summary: VcfQcSummary; preview: VcfPreview[] };
const BIN_LABELS = ["0–<10", "10–<20", "20–<30", "30–<40", "40–<60", "60–<100", "100+"];
export const QUALITY_LABELS: readonly string[] = BIN_LABELS;
const DNA = /^[ACGTN]+$/i;
const CONTIG = /^[A-Za-z0-9_.:-]{1,100}$/;
const HEADER = ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO"];
const MAX_CHROMS = 2000;

export class VcfQcError extends Error {
  constructor(message: string) { super(message); this.name = "VcfQcError"; }
}
function requireValid(ok: unknown, message: string): asserts ok {
  if (!ok) throw new VcfQcError(message);
}
function category(ref: string, alt: string): VariantCategory {
  const alternatives = alt.split(",");
  if (alternatives.length > 1) return "multiallelic";
  if (!DNA.test(ref) || !DNA.test(alt)) return "complex";
  if (ref.length === 1 && alt.length === 1) return "SNV";
  if (ref.length === alt.length) return "MNV";
  return ref.length < alt.length ? "insertion" : "deletion";
}
function qualityBin(qual: number): number {
  if (qual < 10) return 0;
  if (qual < 20) return 1;
  if (qual < 30) return 2;
  if (qual < 40) return 3;
  if (qual < 60) return 4;
  if (qual < 100) return 5;
  return 6;
}
function isInteger(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}

export function parseVcfQc(text: string): VcfQcResult {
  requireValid(typeof text === "string" && text.length > 0 && text.length <= MAX_VCF_BYTES,
    "VCF is empty or exceeds the 8 MiB inspection limit.");
  // Reject NUL/non-text; no decompression is attempted.
  requireValid(!text.includes("\u0000"), "VCF must be uncompressed UTF-8 text.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  requireValid(lines.length <= MAX_VCF_RECORDS + 3000,
    "VCF contains too many records or header lines.");
  let fileformat = false;
  let headerSeen = false;
  let sampleColumns = 0;
  let records = 0;
  let missingQual = 0;
  let transitions = 0;
  let transversions = 0;
  let filterPass = 0;
  let filterFailed = 0;
  let filterMissing = 0;
  const qualityBins = Array(7).fill(0) as number[];
  const counts = Object.fromEntries(VARIANT_CATEGORIES.map(key => [key, 0])) as Record<VariantCategory,number>;
  const chroms = new Map<string,number>();
  const preview: VcfPreview[] = [];
  let metaLines = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line || line.trim() === "") continue;
    if (!headerSeen) {
      if (line.startsWith("##")) {
        metaLines++;
        requireValid(metaLines <= 2500, "VCF header is too large.");
        if (line.startsWith("##fileformat=")) {
          requireValid(!fileformat && /^##fileformat=VCFv4\.\d+$/.test(line),
            "Expected one VCF v4 fileformat declaration.");
          fileformat = true;
        }
        continue;
      }
      requireValid(fileformat && line.startsWith("#CHROM"),
        "VCF requires a v4 fileformat declaration followed by a #CHROM header.");
      const columns = line.split("\t");
      requireValid(columns.length >= 8 && columns.length <= 109 &&
        HEADER.every((part, i) => columns[i] === part),
        "Invalid VCF column header; the eight required fields must use tabs.");
      requireValid(columns.length === 8 ||
        (columns.length >= 10 && columns[8] === "FORMAT" &&
          columns.slice(9).every(name => name.length > 0 && name.length <= 100) &&
          new Set(columns.slice(9)).size === columns.length - 9),
        "Sample columns require FORMAT and unique, nonempty sample names.");
      sampleColumns = Math.max(0, columns.length - 9);
      headerSeen = true;
      continue;
    }
    requireValid(!line.startsWith("#"), "Unexpected second VCF header or comment within records.");
    const parts = line.split("\t");
    requireValid(parts.length === 8 || parts.length === 9 + sampleColumns,
      "VCF row has an inconsistent number of tab-separated columns (line " + (index+1) + ").");
    requireValid(parts.length === (sampleColumns ? 9 + sampleColumns : 8),
      "VCF rows must match the declared sample columns.");
    const [chrom, rawPos, , ref, alt, rawQual, filter] = parts;
    requireValid(CONTIG.test(chrom), "Invalid chromosome/contig identifier on line " + (index+1) + ".");
    requireValid(/^[1-9][0-9]{0,11}$/.test(rawPos) &&
      Number.isSafeInteger(Number(rawPos)) && Number(rawPos) <= 2_147_483_647,
      "Invalid 1-based VCF position on line " + (index+1) + ".");
    requireValid(DNA.test(ref) && ref.length <= 5000,
      "VCF REF must be a nonempty ungapped A/C/G/T/N allele on line " + (index+1) + ".");
    requireValid(alt.length > 0 && alt.length <= 10000 &&
      alt.split(",").length <= 20 && alt.split(",").every(a =>
        (DNA.test(a) && a.length <= 5000) ||
        /^<(?:DEL|DUP|INS|INV|CNV|NON_REF|\*)>$/.test(a) ||
        a === "*" || a === "."),
      "Unsupported ALT allele on line " + (index+1) + ".");
    let qual: number | null = null;
    if (rawQual === ".") missingQual++;
    else {
      requireValid(/^(?:0|[0-9]+)(?:\.[0-9]+)?$/.test(rawQual), "Invalid QUAL score on line " + (index+1) + ".");
      qual = Number(rawQual);
      requireValid(Number.isFinite(qual) && qual <= 100000000,
        "QUAL score is outside the supported range on line " + (index+1) + ".");
      qualityBins[qualityBin(qual)]++;
    }
    requireValid(filter === "." || filter === "PASS" ||
      (filter.length <= 512 && filter.split(";").every(f=>/^[A-Za-z0-9_.-]{1,80}$/.test(f)) &&
        filter.split(";").every(f=>f !== "PASS")),
      "Invalid FILTER field on line " + (index+1) + ".");
    if (filter === "PASS") filterPass++;
    else if (filter === ".") filterMissing++;
    else filterFailed++;
    const type = category(ref,alt);
    counts[type]++;
    if (type === "SNV") {
      const x = ref.toUpperCase(), y = alt.toUpperCase();
      if ("ACGT".includes(x) && "ACGT".includes(y) && x !== y) {
        if ((x==="A" && y==="G") || (x==="G" && y==="A") ||
            (x==="C" && y==="T") || (x==="T" && y==="C")) transitions++;
        else transversions++;
      }
    }
    if (!chroms.has(chrom) && chroms.size >= MAX_CHROMS)
      throw new VcfQcError("VCF contains more than 2000 distinct contigs.");
    chroms.set(chrom,(chroms.get(chrom)??0)+1);
    if (preview.length < MAX_VCF_PREVIEW) preview.push({
      chrom, pos:Number(rawPos), ref, alt, qual, filter, category:type,
    });
    records++;
    requireValid(records <= MAX_VCF_RECORDS,"VCF exceeds the 50000-record analysis limit.");
  }
  requireValid(headerSeen, "VCF #CHROM header is missing.");
  requireValid(records>0, "VCF contains no variant records.");
  const chromCounts=[...chroms].map(([chrom,count])=>({chrom,count}))
    .sort((a,b)=>b.count-a.count||a.chrom.localeCompare(b.chrom)).slice(0,12);
  return { summary: {
    schema:"genithm-vcf-qc-summary/1",analyzerVersion:VCF_QC_VERSION,
    totalRecords:records,sampleColumns,variantCounts:counts,
    filterCounts:{pass:filterPass,filtered:filterFailed,missing:filterMissing},
    qualityBins,missingQual,transitions,transversions,
    chromCounts,distinctChromosomes:chroms.size,
  }, preview };
}

export function validateVcfQcSummary(v: unknown): v is VcfQcSummary {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const x=v as Record<string,unknown>;
  const expectedKeys=[
    "schema","analyzerVersion","totalRecords","sampleColumns","variantCounts",
    "filterCounts","qualityBins","missingQual","transitions","transversions",
    "chromCounts","distinctChromosomes",
  ];
  if(Object.keys(x).sort().join("|")!==expectedKeys.sort().join("|")) return false;
  if (x.schema!=="genithm-vcf-qc-summary/1" || x.analyzerVersion!==VCF_QC_VERSION ||
    !isInteger(x.totalRecords,1,MAX_VCF_RECORDS)||!isInteger(x.sampleColumns,0,100) ||
    !isInteger(x.missingQual,0,x.totalRecords)||!isInteger(x.transitions,0,x.totalRecords) ||
    !isInteger(x.transversions,0,x.totalRecords)||
    !isInteger(x.distinctChromosomes,1,MAX_CHROMS)) return false;
  const n=x.totalRecords as number;
  const cat=x.variantCounts, filt=x.filterCounts;
  if(!cat||typeof cat!=="object"||Array.isArray(cat)||
    !filt||typeof filt!=="object"||Array.isArray(filt)) return false;
  const types=cat as Record<string,unknown>,filters=filt as Record<string,unknown>;
  if(Object.keys(types).sort().join("|")!==[...VARIANT_CATEGORIES].sort().join("|") ||
    Object.keys(filters).sort().join("|")!==["pass","filtered","missing"].sort().join("|")) return false;
  const tc=VARIANT_CATEGORIES.map(k=>types[k]);
  if(!tc.every(v=>isInteger(v,0,n)) ||
    tc.reduce<number>((a,v)=>a+(v as number),0)!==n) return false;
  if(!(["pass","filtered","missing"].every(k=>isInteger(filters[k],0,n))) ||
    (filters.pass as number)+(filters.filtered as number)+(filters.missing as number)!==n) return false;
  if(!Array.isArray(x.qualityBins)||x.qualityBins.length!==7||
    !x.qualityBins.every(v=>isInteger(v,0,n))||
    x.qualityBins.reduce<number>((a,v)=>a+v,0)+ (x.missingQual as number)!==n) return false;
  if((x.transitions as number)+(x.transversions as number)>(types.SNV as number)) return false;
  if(!Array.isArray(x.chromCounts) || x.chromCounts.length<1 || x.chromCounts.length>12 ||
    x.chromCounts.length>(x.distinctChromosomes as number))return false;
  const seen=new Set<string>();let sum=0;
  for(const item of x.chromCounts) {
    if(!item||typeof item!=="object"||Array.isArray(item)) return false;
    let z=item as Record<string,unknown>;
    if(Object.keys(z).sort().join("|")!=="chrom|count") return false;
    if(typeof z.chrom!=="string"||!CONTIG.test(z.chrom)||seen.has(z.chrom)||
      !isInteger(z.count,1,n))return false;
    seen.add(z.chrom); sum+=(z.count as number);
  }
  if((x.distinctChromosomes as number)<=12 && sum!==n)return false;
  if((x.distinctChromosomes as number)>12 && sum>n)return false;
  return true;
}

function safeCell(v:string|number):string {
  const s=String(v).replace(/[\r\n\t\u0000-\u001f]/g," ");
  return /^[=+@]|^-(?!\d+(?:\.\d+)?(?:e[+-]?\d+)?$)/i.test(s)?"'"+s:s;
}
export function vcfQcSummaryTsv(v:VcfQcSummary, fingerprint:string):string {
  if(!validateVcfQcSummary(v)||!/^[a-f0-9]{64}$/.test(fingerprint))
    throw new VcfQcError("Summary or source fingerprint is invalid.");
  const rows:(string|number)[][]=[
    ["Genithm VCF QC (local, exploratory, non-clinical)"],
    ["Analyzer",v.analyzerVersion],["Client-computed source SHA-256",fingerprint],
    ["Integrity caveat","Input hash and summary are client-computed; no server-side source verification was performed."],
    ["Total records",v.totalRecords],["Sample columns (contents not analyzed)",v.sampleColumns],
    ["Ti/Tv (biallelic canonical SNVs only)",v.transversions?v.transitions/v.transversions:"undefined"],
    ["Transitions",v.transitions],["Transversions",v.transversions],["Missing QUAL",v.missingQual],
    [],["Variant category","Count"],
    ...VARIANT_CATEGORIES.map(t=>[t,v.variantCounts[t]]),
    [],["FILTER category","Count"],
    ["PASS",v.filterCounts.pass],["Filtered",v.filterCounts.filtered],["Missing",v.filterCounts.missing],
    [],["QUAL band","Count"],...QUALITY_LABELS.map((t,i)=>[t,v.qualityBins[i]]),
    [],["Contig (top 12)","Count"],...v.chromCounts.map(t=>[t.chrom,t.count]),
  ];
  return rows.map(r=>r.map(safeCell).join("\t")).join("\n")+"\n";
}
