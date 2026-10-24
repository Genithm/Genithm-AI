/** Genithm V63: bounded BGZF-compressed BAM binary alignment quality control.
 * Decodes the BAM envelope and record core; base sequences, qualities and
 * read names never enter exported results or AI-provider prompts.
 * Reference/CIGAR/MAPQ aggregation reuses the reviewed V62 SAM QC engine.
 */
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {samQualityControl} from './chat_sam_qc.mjs';

export const BAM_QC_VERSION = 'genithm-bam-qc/1.0.0';
const MAX_COMPRESSED=12*1024*1024, MAX_DECODED=20*1024*1024;
const MAX_SYNTHETIC_SAM=12*1024*1024, MAX_RECORDS=120000;
const MAX_HEADER=1024*1024,MAX_REFS=2000,MAX_READ=50000,MAX_CIGAR=256;
const CIGAR='MIDNSHP=X';
const fail=message=>{throw new Error(message)};
const check=(yes,message)=>{if(!yes)fail(message)};
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=o=>JSON.stringify(o,null,2)+'\n';
const MAX_BLOCK=1024*1024;

/** BGZF stores a BC subfield with BSIZE=compressed block bytes minus one. */
export function decodeBgzf(buffer){
 check(Buffer.isBuffer(buffer)&&buffer.length>=26&&buffer.length<=MAX_COMPRESSED,
  'BAM input must be BGZF compressed and at most 12 MiB.');
 let offset=0,blocks=0,totalDecoded=0,eof=false;
 while(offset<buffer.length){
  check(offset+18<=buffer.length,'Truncated BGZF header.');
  check(buffer[offset]===31&&buffer[offset+1]===139&&buffer[offset+2]===8&&buffer[offset+3]===4,
   'BAM requires BGZF gzip members with FEXTRA (not ordinary gzip).');
  const xlen=buffer.readUInt16LE(offset+10),endExtra=offset+12+xlen;
  check(xlen>=6&&endExtra+8<=buffer.length,'Truncated BGZF extra fields.');
  let i=offset+12,bsize=null;
  while(i<endExtra){
   check(i+4<=endExtra,'Malformed BGZF extra-field header.');
   const slen=buffer.readUInt16LE(i+2),end=i+4+slen;
   check(end<=endExtra,'Truncated BGZF subfield.');
   if(buffer[i]===66&&buffer[i+1]===67){
    check(slen===2&&bsize===null,'Malformed or duplicate BGZF BC subfield.');
    bsize=buffer.readUInt16LE(i+4)+1;
   }
   i=end;
  }
  check(bsize!==null&&bsize>=xlen+20&&bsize<=65536,
   'Missing BGZF BC block-size marker or invalid block length.');
  const endBlock=offset+bsize;
  check(endBlock<=buffer.length&&endBlock>=endExtra+8,'Truncated BGZF block.');
  const isize=buffer.readUInt32LE(endBlock-4);
  check(isize<=65536,'BGZF member expands beyond the 64 KiB block limit.');
  totalDecoded+=isize;
  check(totalDecoded<=MAX_DECODED,'BAM expands beyond the permitted 20 MiB decoded limit.');
  eof=isize===0;
  offset=endBlock;blocks++;
  check(blocks<=200000,'Excessive BGZF blocks.');
 }
 let decoded;
 try{decoded=gunzipSync(buffer,{maxOutputLength:MAX_DECODED+1});}
 catch{fail('BAM BGZF CRC/decompression failed, or the decompressed input exceeded 20 MiB.');}
 check(decoded.length===totalDecoded,'BGZF decoded size does not match individual block ISIZE fields.');
 return {decoded,bgzfBlocks:blocks,eofMarkerPresent:eof};
}

function parseAux(bytes,start,end){
 let p=start,nm=null,nmSeen=false,auxCount=0;
 const limit=(n,msg)=>check(p+n<=end,msg);
 while(p<end){
  limit(3,'Truncated BAM auxiliary tag.');
  const a=bytes[p],b=bytes[p+1],type=String.fromCharCode(bytes[p+2]);
  check(((a>=65&&a<=90)||(a>=97&&a<=122))&&
   ((b>=65&&b<=90)||(b>=97&&b<=122)||(b>=48&&b<=57)),
   'Invalid BAM optional tag name.');
  const tag=String.fromCharCode(a,b);p+=3;auxCount++;
  check(auxCount<=64,'BAM alignment has over 64 auxiliary tags.');
  check(tag!=='CG','BAM long-CIGAR CG:B,I representation exceeds this bounded QC engine.');
  let value=null;
  if(type==='A'||type==='c'||type==='C'){
   limit(1,'Truncated 8-bit BAM auxiliary value.');
   value=type==='c'?bytes.readInt8(p):bytes[p];p++;
  }else if(type==='s'||type==='S'){
   limit(2,'Truncated 16-bit BAM auxiliary value.');
   value=type==='s'?bytes.readInt16LE(p):bytes.readUInt16LE(p);p+=2;
  }else if(type==='i'||type==='I'||type==='f'){
   limit(4,'Truncated 32-bit BAM auxiliary value.');
   value=type==='i'?bytes.readInt32LE(p):type==='I'?bytes.readUInt32LE(p):bytes.readFloatLE(p);p+=4;
  }else if(type==='Z'||type==='H'){
   const zero=bytes.indexOf(0,p);
   check(zero!==-1&&zero<end,'Unterminated BAM string auxiliary value.');
   if(type==='H')check((zero-p)%2===0,'Odd-length BAM hex auxiliary value.');
   p=zero+1;
  }else if(type==='B'){
   limit(5,'Truncated BAM auxiliary array header.');
   const subtype=String.fromCharCode(bytes[p]);
   check('cCsSiIf'.includes(subtype),'Unsupported BAM auxiliary array subtype.');
   const count=bytes.readInt32LE(p+1);
   check(count>=0&&count<=1000000,'Invalid BAM auxiliary array length.');
   const width='cC'.includes(subtype)?1:'sS'.includes(subtype)?2:4;
   p+=5;limit(count*width,'Truncated BAM auxiliary array.');p+=count*width;
  }else fail('Unsupported BAM auxiliary value type.');
  if(tag==='NM'){
   check(!nmSeen,'Duplicate BAM NM edit-distance tag.');nmSeen=true;
   check('cCsSiI'.includes(type)&&Number.isSafeInteger(value)&&value>=0&&value<=10000000000,
    'Malformed BAM NM integer edit-distance tag.');
   nm=value;
  }
 }
 return nm;
}

/** Parse BAM without exposing original read names or bases to outputs. */
export function parseBam(buffer){
 const {decoded,bgzfBlocks,eofMarkerPresent}=decodeBgzf(buffer);
 let p=0;
 const need=(n,context)=>check(p+n<=decoded.length,`Truncated BAM ${context}.`);
 const readI=(context)=>{need(4,context);const n=decoded.readInt32LE(p);p+=4;return n;};
 need(8,'magic and SAM header length');
 check(decoded.subarray(0,4).equals(Buffer.from([66,65,77,1])),'Invalid BAM magic identifier.');p=4;
 const textLength=readI('SAM header length');
 check(textLength>=0&&textLength<=MAX_HEADER,'Invalid BAM header text length.');
 need(textLength,'header text');
 const text=decoded.subarray(p,p+textLength);p+=textLength;
 check(!text.includes(0),'Binary NUL in BAM SAM header text.');
 try{new TextDecoder('utf-8',{fatal:true}).decode(text);}catch{fail('Invalid UTF-8 BAM header text.');}
 const nRef=readI('reference count');
 check(nRef>=0&&nRef<=MAX_REFS,'BAM reference dictionary exceeds 2,000 references.');
 const refs=[],used=new Set();
 for(let i=0;i<nRef;i++){
  const nameLength=readI('reference name length');
  check(nameLength>=2&&nameLength<=181,'Invalid BAM reference name length.');
  need(nameLength+4,'reference dictionary item');
  check(decoded[p+nameLength-1]===0,'BAM reference is not NUL terminated.');
  let name;
  try{name=new TextDecoder('utf-8',{fatal:true}).decode(decoded.subarray(p,p+nameLength-1));}
  catch{fail('Invalid UTF-8 BAM reference name.');}
  check(name.length<=180&&name.length>0&&name!=='*'&&!/\s|[\x00-\x1f\x7f]/.test(name)&&!used.has(name),
   'Invalid or duplicate BAM reference name.');
  used.add(name);p+=nameLength;
  const length=readI('reference length');
  check(length>=1,'Invalid BAM reference length.');
  refs.push({name,length});
 }
 const lines=refs.map(ref=>`@SQ\tSN:${ref.name}\tLN:${ref.length}`);
 let syntheticBytes=lines.reduce((n,l)=>n+l.length+1,0),recordCount=0;
 while(p<decoded.length){
  const blockSize=readI('alignment block length');
  check(blockSize>=32&&blockSize<=MAX_BLOCK,'Invalid BAM alignment block size.');
  const end=p+blockSize;
  check(end<=decoded.length,'Truncated BAM alignment block.');
  const base=p;
  const refId=decoded.readInt32LE(base),pos=decoded.readInt32LE(base+4);
  const readNameLength=decoded[base+8],mapq=decoded[base+9];
  const nCigar=decoded.readUInt16LE(base+12),flag=decoded.readUInt16LE(base+14);
  const seqLen=decoded.readInt32LE(base+16),nextRef=decoded.readInt32LE(base+20),
   nextPos=decoded.readInt32LE(base+24),templateLength=decoded.readInt32LE(base+28);
  check(refId>=-1&&refId<nRef&&nextRef>=-1&&nextRef<nRef,
   'BAM alignment contains an out-of-range reference ID.');
  check(pos>=-1&&nextPos>=-1,'BAM alignment contains negative coordinates other than -1.');
  check(readNameLength>=2&&readNameLength<=255&&nCigar<=MAX_CIGAR&&seqLen>=0&&seqLen<=MAX_READ,
   'BAM read name, CIGAR or sequence exceeds bounded QC limits.');
  p=base+32;
  need(readNameLength+nCigar*4+Math.ceil(seqLen/2)+seqLen,'BAM alignment payload');
  check(p+readNameLength+nCigar*4+Math.ceil(seqLen/2)+seqLen<=end,
   'BAM alignment payload overruns its block.');
  check(decoded[p+readNameLength-1]===0,'BAM alignment read name lacks terminating NUL.');
  for(let i=0;i<readNameLength-1;i++)check(decoded[p+i]>=33&&decoded[p+i]<=126,
   'Invalid BAM QNAME ASCII bytes.');
  p+=readNameLength;
  let cigar='',queryLength=0;
  for(let i=0;i<nCigar;i++){
   const op=decoded.readUInt32LE(p);p+=4;
   const length=op>>>4,kind=op&15;
   check(length>0&&kind<CIGAR.length,'Unsupported BAM CIGAR operation or zero-length run.');
   const symbol=CIGAR[kind];cigar+=`${length}${symbol}`;
   if('MIS=X'.includes(symbol))queryLength+=length;
   check(queryLength<=50000000&&cigar.length<=4096,'BAM CIGAR query/length limit exceeded.');
  }
  const mapped=!(flag&4);
  check(!mapped||refId>=0&&pos>=0&&nCigar>0,'BAM mapped alignment is missing reference, position or CIGAR.');
  if(mapped)check(queryLength===seqLen,'BAM sequence length differs from CIGAR query consumption.');
  p+=Math.ceil(seqLen/2);
  const quality=p;
  let missing=0;
  for(let i=0;i<seqLen;i++){
   const q=decoded[quality+i];check(q<=93||q===255,'BAM quality score exceeds accepted Phred bound.');
   if(q===255)missing++;
  }
  check(!missing||missing===seqLen,'BAM quality array mixes unknown and numeric scores.');
  p+=seqLen;
  const nm=parseAux(decoded,p,end);p=end;
  const ref=refId>=0?refs[refId].name:'*';
  const mate=nextRef<0?'*':nextRef===refId?'=':refs[nextRef].name;
  const row=[`read${recordCount+1}`,flag,ref,pos>=0?pos+1:0,mapq,cigar||'*',mate,
   nextPos>=0?nextPos+1:0,templateLength,'*','*'];
  if(nm!==null)row.push(`NM:i:${nm}`);
  const line=row.join('\t');syntheticBytes+=line.length+1;
  check(syntheticBytes<=MAX_SYNTHETIC_SAM,
   'Converted alignment records exceed bounded 12 MiB in-memory QC limit.');
  lines.push(line);recordCount++;
  check(recordCount<=MAX_RECORDS,'BAM exceeds 120,000 alignment records.');
 }
 check(recordCount>0,'BAM has no alignment records.');
 return {samText:lines.join('\n')+'\n',recordCount,bgzfBlocks,eofMarkerPresent,decodedBytes:decoded.length,references:refs.length};
}

export function bamQualityControl(files){
 check(Object.keys(files).length===1&&Buffer.isBuffer(files.bam),
  'BAM QC requires exactly one binary BAM file.');
 const raw=files.bam,decoded=parseBam(raw);
 const analyzed=samQualityControl({sam:Buffer.from(decoded.samText,'utf8')});
 const summary={...analyzed.summary,kind:'bam-qc',inputs:'user-provided',
  method:'CRC-validated BGZF BAM binary parsing and deterministic FLAG, MAPQ, CIGAR and unioned primary M/=/X reference coverage',
  bam_decompressed_bytes:decoded.decodedBytes,bgzf_members:decoded.bgzfBlocks,
  bgzf_eof_marker_present:decoded.eofMarkerPresent,
  warnings:analyzed.summary.warnings.filter(x=>!x.startsWith('SAM text and SAM.gz only'))
   .map(x=>x.replace(/SAM alignment records/g,'BAM alignment records'))
   .concat('BAM/BGZF binary records are decoded; CRAM, BAM indexes, long-CIGAR CG records, depth distributions and base-level reference comparisons are not supported.',
    ...(!decoded.eofMarkerPresent?['The conventional final BGZF EOF marker is missing; file truncation cannot be ruled out.']:[]))};
 const provenance={schema:'genithm-bam-qc-provenance/1',engine:BAM_QC_VERSION,kind:'bam-qc',
  generated_at_utc:new Date().toISOString(),method:summary.method,
  source_files:{bam:{bytes:raw.length,sha256:hash(raw)}},
  limits:{compressed_bytes:MAX_COMPRESSED,decompressed_bytes:MAX_DECODED,alignment_records:MAX_RECORDS},
  original_read_names_or_bases_exported:false,
  compute_scope:'Consent-based private Genithm Codespaces worker, original file deleted after verification',
  limitations:summary.warnings};
 const outputs={
  'bam-mapping-qc.tsv':analyzed.outputs['sam-mapping-qc.tsv'],
  'bam-reference-coverage.tsv':analyzed.outputs['sam-reference-coverage.tsv'],
  'bam-cigar-operations.tsv':analyzed.outputs['sam-cigar-operations.tsv'],
  'bam-mapq.svg':analyzed.outputs['sam-mapq.svg'].replaceAll('SAM alignment','BAM alignment'),
  'summary.json':json(summary),
  'provenance.json':json(provenance),
  'METHODS.md':'# Genithm BAM alignment quality control\n\n'+summary.method+'\n\n'+
   'Actual compressed BAM bytes were decompressed and validated. Internal read identifiers were deliberately replaced and base sequences not decoded into the QC interchange. No LLM calculated statistics.\n\n'+
   '## Limitations\n'+summary.warnings.map(x=>'- '+x).join('\n')+'\n'
 };
 return {summary,provenance,outputs};
}