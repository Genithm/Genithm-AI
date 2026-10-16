/**
 * Genithm V39: deterministic local FASTQ v1 inspection.
 * Assumes Phred+33 encoding. Never uploads read sequences, quality strings,
 * sample identifiers, or mate IDs.
 */
export const FASTQ_QC_VERSION = "genithm-fastq-qc/1.0.0" as const;
export const FASTQ_QC_SCHEMA = "genithm-fastq-qc-summary/1" as const;
export const MAX_FASTQ_BYTES = 12 * 1024 * 1024;
export const MAX_FASTQ_READS = 100_000;
export const MAX_READ_LENGTH = 400;
export const LENGTH_BANDS = ["1–50", "51–75", "76–100", "101–150", "151–200", "201–300", "301–400"] as const;
export const QUALITY_BANDS = ["Q0–9", "Q10–19", "Q20–29", "Q30–39", "Q40+"] as const;

export type FastqReadSummary = {
  readCount: number;
  baseCount: number;
  minLength: number;
  maxLength: number;
  meanLength: number;
  meanPhred: number;
  gcPercent: number | null;
  nPercent: number;
  q20BaseCount: number;
  q30BaseCount: number;
  baseCounts: { A: number; C: number; G: number; T: number; N: number };
  lengthBands: number[];
  qualityBands: number[];
  /** Each index represents a one-based cycle; [reads reaching cycle, mean Phred, Q30 %]. */
  perCycle: [number, number, number][];
};

export type FastqQcSummary = {
  schema: typeof FASTQ_QC_SCHEMA;
  analyzerVersion: typeof FASTQ_QC_VERSION;
  mode: "single" | "paired";
  encoding: "phred33";
  matesChecked: boolean;
  reads: FastqReadSummary[];
};

export class FastqQcError extends Error {
  constructor(message: string) { super(message); this.name = "FastqQcError"; }
}
const isInt=(n:unknown,min:number,max:number):n is number=>
  typeof n==="number"&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const rounded=(n:number,digits:number)=>Number(n.toFixed(digits));
const ID=/^[^\s\x00-\x1f]{1,250}$/;
const letters=new Set(["A","C","G","T","N"]);

function readIdentifier(header:string):{key:string;readNo:1|2|null}{
  const raw=header.slice(1);
  const tokens=raw.split(/\s+/);
  if(!tokens[0]||!ID.test(tokens[0]))throw new FastqQcError("FASTQ record identifier is missing or malformed.");
  let key=tokens[0];
  let readNo:1|2|null=null;
  if(key.endsWith("/1")||key.endsWith("/2")){
    readNo=key.endsWith("/1")?1:2;
    key=key.slice(0,-2);
  }
  if(tokens[1]&&/^[12]:[YN]:\d+:[^\s]+$/.test(tokens[1])){
    const casava=tokens[1][0]==="1"?1:2;
    if(readNo!==null && readNo!==casava)
      throw new FastqQcError("FASTQ read-number suffix conflicts with CASAVA header.");
    readNo=casava;
  }
  if(!key)throw new FastqQcError("FASTQ read identifier is empty.");
  return {key,readNo};
}

export type ParsedFastq = {
  summary:FastqReadSummary;
  /** Private, never persisted. Only used to verify paired record order. */
  identifiers:{key:string;readNo:1|2|null}[];
};

export function parseFastq(text:string):ParsedFastq {
  if(typeof text!=="string"||text.length<4||text.length>MAX_FASTQ_BYTES)
    throw new FastqQcError("FASTQ is empty or exceeds the 12 MiB local limit.");
  if(text.includes("\0")||text.startsWith("\uFFFD"))
    throw new FastqQcError("FASTQ must be uncompressed UTF-8 text.");
  // Reject CR-only multiline ambiguity, tolerate LF and CRLF.
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/);
  if(lines.at(-1)==="")lines.pop();
  if(lines.length%4!==0||lines.length===0)
    throw new FastqQcError("FASTQ requires complete 4-line records; wrapped reads are not supported.");
  const count=lines.length/4;
  if(count>MAX_FASTQ_READS)throw new FastqQcError("FASTQ exceeds 100,000 read records.");
  const baseCounts={A:0,C:0,G:0,T:0,N:0};
  const lengthBands=Array<number>(7).fill(0);
  const qualityBands=Array<number>(5).fill(0);
  const cycleCount=Array<number>(MAX_READ_LENGTH).fill(0);
  const cyclePhred=Array<number>(MAX_READ_LENGTH).fill(0);
  const cycleQ30=Array<number>(MAX_READ_LENGTH).fill(0);
  const identifiers:{key:string;readNo:1|2|null}[]=[];
  let totalBases=0,phredSum=0,q20=0,q30=0,minLength=MAX_READ_LENGTH+1,maxLength=0;
  for(let i=0;i<lines.length;i+=4){
    const header=lines[i],sequence=lines[i+1].toUpperCase(),plus=lines[i+2],quality=lines[i+3];
    const lineNo=i+1;
    if(!header.startsWith("@"))
      throw new FastqQcError("Expected @ identifier at line "+lineNo+".");
    const identity=readIdentifier(header);
    if(!plus.startsWith("+") || (plus.length>1 && plus.slice(1)!==header.slice(1)))
      throw new FastqQcError("FASTQ + header mismatch near line "+(lineNo+2)+".");
    if(sequence.length<1||sequence.length>MAX_READ_LENGTH)
      throw new FastqQcError("Read length must be 1–400 bases at line "+(lineNo+1)+".");
    if(!/^[ACGTN]+$/.test(sequence))
      throw new FastqQcError("FASTQ sequence contains unsupported nucleotide symbols at line "+(lineNo+1)+".");
    if(quality.length!==sequence.length)
      throw new FastqQcError("Sequence and Phred quality lengths differ near line "+lineNo+".");
    identifiers.push(identity);
    const length=sequence.length;
    totalBases+=length;
    minLength=Math.min(minLength,length);maxLength=Math.max(maxLength,length);
    const lengthIndex= length<=50?0:length<=75?1:length<=100?2:length<=150?3:length<=200?4:length<=300?5:6;
    lengthBands[lengthIndex]++;
    for(let j=0;j<length;j++){
      const base=sequence[j] as keyof typeof baseCounts;
      if(!letters.has(base))throw new FastqQcError("Unexpected nucleotide symbol.");
      baseCounts[base]++;
      const ascii=quality.charCodeAt(j);
      if(ascii<33||ascii>126)
        throw new FastqQcError("Invalid Phred+33 quality byte near line "+(lineNo+3)+".");
      const q=ascii-33;
      phredSum+=q;cycleCount[j]++;cyclePhred[j]+=q;
      if(q>=20)q20++;
      if(q>=30){q30++;cycleQ30[j]++;}
      qualityBands[q<10?0:q<20?1:q<30?2:q<40?3:4]++;
    }
  }
  const known=totalBases-baseCounts.N;
  const gcPercent=known?rounded((baseCounts.G+baseCounts.C)/known*100,2):null;
  return {
    identifiers,
    summary:{
      readCount:count,baseCount:totalBases,minLength,maxLength,
      meanLength:rounded(totalBases/count,3),
      meanPhred:rounded(phredSum/totalBases,3),
      gcPercent,nPercent:rounded(baseCounts.N/totalBases*100,2),
      q20BaseCount:q20,q30BaseCount:q30,baseCounts,lengthBands,qualityBands,
      perCycle:cycleCount.slice(0,maxLength).map((n,j)=>[
        n,rounded(cyclePhred[j]/n,3),rounded(cycleQ30[j]/n*100,2),
      ]),
    },
  };
}

export function analyzeFastqQc(r1:string,r2?:string):FastqQcSummary {
  const first=parseFastq(r1);
  if(r2===undefined)return {
    schema:FASTQ_QC_SCHEMA,analyzerVersion:FASTQ_QC_VERSION,
    mode:"single",encoding:"phred33",matesChecked:false,reads:[first.summary],
  };
  const second=parseFastq(r2);
  if(first.summary.readCount!==second.summary.readCount)
    throw new FastqQcError("R1 and R2 read counts do not match.");
  for(let i=0;i<first.identifiers.length;i++){
    const a=first.identifiers[i],b=second.identifiers[i];
    if(a.key!==b.key || a.readNo===2 || b.readNo===1 ||
       (a.readNo!==null&&b.readNo!==null&&(a.readNo!==1||b.readNo!==2)))
      throw new FastqQcError("Paired-read IDs or mate order disagree at record "+(i+1)+".");
  }
  return {
    schema:FASTQ_QC_SCHEMA,analyzerVersion:FASTQ_QC_VERSION,
    mode:"paired",encoding:"phred33",matesChecked:true,reads:[first.summary,second.summary],
  };
}

const exactKeys=(o:Record<string,unknown>,names:string[]) =>
  Object.keys(o).sort().join("|")===names.sort().join("|");

function validRead(v:unknown):v is FastqReadSummary {
  if(!v||typeof v!=="object"||Array.isArray(v))return false;
  const o=v as Record<string,unknown>;
  if(!exactKeys(o,[
    "readCount","baseCount","minLength","maxLength","meanLength","meanPhred",
    "gcPercent","nPercent","q20BaseCount","q30BaseCount","baseCounts",
    "lengthBands","qualityBands","perCycle",
  ]))return false;
  const n=o.readCount,b=o.baseCount;
  if(!isInt(n,1,MAX_FASTQ_READS)||!isInt(b,n,MAX_FASTQ_READS*MAX_READ_LENGTH)||
    !isInt(o.minLength,1,MAX_READ_LENGTH)||!isInt(o.maxLength,o.minLength,MAX_READ_LENGTH)||
    !isInt(o.q20BaseCount,0,b)||!isInt(o.q30BaseCount,0,o.q20BaseCount)||
    typeof o.meanLength!=="number"||!Number.isFinite(o.meanLength)||
    Math.abs(o.meanLength-b/n)>0.0011||
    typeof o.meanPhred!=="number"||!Number.isFinite(o.meanPhred)||o.meanPhred<0||o.meanPhred>93||
    typeof o.nPercent!=="number"||o.nPercent<0||o.nPercent>100)return false;
  const bc=o.baseCounts;
  if(!bc||typeof bc!=="object"||Array.isArray(bc))return false;
  const bases=bc as Record<string,unknown>;
  if(!exactKeys(bases,["A","C","G","T","N"])||
    !Object.values(bases).every(x=>isInt(x,0,b))||
    (Object.values(bases) as number[]).reduce((a,x)=>a+x,0)!==b)return false;
  const known=b-(bases.N as number),expectedGc=known?(bases.G as number+bases.C as number)/known*100:null;
  if(expectedGc===null ? o.gcPercent!==null :
    typeof o.gcPercent!=="number"||Math.abs(o.gcPercent-expectedGc)>0.011)return false;
  if(Math.abs(o.nPercent-(bases.N as number)/b*100)>0.011)return false;
  if(!Array.isArray(o.lengthBands)||o.lengthBands.length!==7||
    !o.lengthBands.every(x=>isInt(x,0,n))||
    o.lengthBands.reduce<number>((a,x)=>a+x,0)!==n)return false;
  if(!Array.isArray(o.qualityBands)||o.qualityBands.length!==5||
    !o.qualityBands.every(x=>isInt(x,0,b))||
    o.qualityBands.reduce<number>((a,x)=>a+x,0)!==b)return false;
  const bins=o.qualityBands as number[];
  if(o.q20BaseCount!==bins[2]+bins[3]+bins[4]||
    o.q30BaseCount!==bins[3]+bins[4])return false;
  if(!Array.isArray(o.perCycle)||o.perCycle.length!==o.maxLength)return false;
  let cycleBases=0,previous=n as number,cycleQ30=0,weightedQ=0;
  for(const item of o.perCycle){
    if(!Array.isArray(item)||item.length!==3||
      !isInt(item[0],1,n)||item[0]>previous||
      typeof item[1]!=="number"||!Number.isFinite(item[1])||item[1]<0||item[1]>93||
      typeof item[2]!=="number"||!Number.isFinite(item[2])||item[2]<0||item[2]>100)return false;
    previous=item[0];cycleBases+=item[0];weightedQ+=item[0]*item[1];
    cycleQ30+=Math.round(item[0]*item[2]/100);
  }
  return o.perCycle[0][0]===n && cycleBases===b &&
    Math.abs(weightedQ/b-(o.meanPhred as number))<0.003 &&
    Math.abs(cycleQ30-(o.q30BaseCount as number))<=o.perCycle.length*0.01+1;
}
export function validateFastqQcSummary(v:unknown):v is FastqQcSummary{
  if(!v||typeof v!=="object"||Array.isArray(v))return false;
  const o=v as Record<string,unknown>;
  if(!exactKeys(o,["schema","analyzerVersion","mode","encoding","matesChecked","reads"])||
    o.schema!==FASTQ_QC_SCHEMA||o.analyzerVersion!==FASTQ_QC_VERSION||
    o.encoding!=="phred33"||(o.mode!=="single"&&o.mode!=="paired")||
    o.matesChecked!==(o.mode==="paired")||
    !Array.isArray(o.reads)||o.reads.length!==(o.mode==="paired"?2:1)||
    !o.reads.every(validRead))return false;
  return o.mode!=="paired"||o.reads[0].readCount===o.reads[1].readCount;
}
function safeTsv(v:string|number):string{
  const x=String(v).replace(/[\r\n\t\u0000-\u001f]/g," ");
  return /^[=+@]|^-(?!\d+(?:\.\d+)?(?:e[+-]?\d+)?$)/i.test(x)?"'"+x:x;
}
export function fastqQcTsv(summary:FastqQcSummary,hashes:string[]):string{
  if(!validateFastqQcSummary(summary)||hashes.length!==summary.reads.length||
     !hashes.every(h=>/^[a-f0-9]{64}$/.test(h)))
    throw new FastqQcError("Invalid FASTQ aggregate summary or source fingerprints.");
  const rows:Array<Array<string|number>>=[
    ["Genithm FASTQ QC · exploratory browser-side metrics"],
    ["Analyzer",FASTQ_QC_VERSION],["Encoding","Phred+33 (assumed, not autodetected)"],
    ["Source status","Client-computed SHA-256 only; not independently server-verified"],
    ["Paired identifiers checked",summary.matesChecked?"yes":"not paired"],[],
    ["Metric","R1",...(summary.mode==="paired"?["R2"]:[])],
  ];
  const metric=(title:string,get:(r:FastqReadSummary)=>string|number)=>
    rows.push([title,...summary.reads.map(get)]);
  metric("Read count",r=>r.readCount);
  metric("Base count",r=>r.baseCount);
  metric("Mean Phred",r=>r.meanPhred);
  metric("Mean read length",r=>r.meanLength);
  metric("GC % (excluding N)",r=>r.gcPercent??"undefined");
  metric("N %",r=>r.nPercent);
  metric("Q20 bases",r=>r.q20BaseCount);
  metric("Q30 bases",r=>r.q30BaseCount);
  summary.reads.forEach((r,i)=>{
    rows.push([],["Mate",i===0?"R1":"R2"],["Source SHA-256",hashes[i]],
      ["Cycle","Reads reaching cycle","Mean Phred","Q30 %"]);
    r.perCycle.forEach(([count,q,q30],index)=>rows.push([index+1,count,q,q30]));
  });
  return rows.map(cells=>cells.map(safeTsv).join("\t")).join("\n")+"\n";
}
