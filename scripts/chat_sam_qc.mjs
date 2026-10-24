/** Genithm V62: deterministic, bounded SAM alignment-file quality control.
 * Original reads never leave the restricted scientific worker for an LLM.
 * SAM alignment records are NOT unique reads or fragments.
 */
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
export const SAM_QC_VERSION='genithm-sam-qc/1.0.0';
const MAX_INPUT=12*1024*1024,MAX_RECORDS=120000,MAX_REFS=2000,MAX_BLOCKS=250000,MAX_CIGAR_OPS=1500000;
const MAX_COORD=10000000000,MAX_READ=50000;
const fail=s=>{throw new Error(s)};
const check=(condition,message)=>{if(!condition)fail(message)};
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const safe=x=>{const s=String(x??'').replace(/[\t\r\n\x00-\x1f]/g,' ');return /^[=+@]|^-(?!\d+(?:\.\d+)?$)/.test(s)?"'"+s:s};
const tsv=rows=>rows.map(row=>row.map(safe).join('\t')).join('\n')+'\n';
const xml=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(s,minimum,maximum,field)=>{check(/^(?:0|[1-9][0-9]*)$/.test(s),`Invalid ${field}: integer required.`);const x=Number(s);check(Number.isSafeInteger(x)&&x>=minimum&&x<=maximum,`Invalid ${field}: outside allowed range.`);return x;};
function textFromBuffer(buffer){
 check(Buffer.isBuffer(buffer)&&buffer.byteLength>0&&buffer.byteLength<=MAX_INPUT,'SAM input must be nonempty and at most 12 MiB.');
 let decoded=buffer;
 if(buffer[0]===31&&buffer[1]===139){try{decoded=gunzipSync(buffer,{maxOutputLength:MAX_INPUT+1})}catch{fail('SAM gzip is invalid or expands beyond 12 MiB.')}}
 check(decoded.byteLength<=MAX_INPUT&&!decoded.includes(0),'SAM is binary or exceeds the decompressed size limit. BAM/CRAM require a separate parser.');
 try{return new TextDecoder('utf-8',{fatal:true}).decode(decoded).replace(/^\uFEFF/,'')}catch{fail('SAM input is not valid UTF-8.')}
}
function readCigar(cigar,seqLength,refStart,refLength,context){
 check(cigar.length<=4096&&/^(?:[1-9][0-9]*[MIDNSHP=X])+$/.test(cigar),`Invalid SAM CIGAR in ${context}.`);
 const tokens=[...cigar.matchAll(/([1-9][0-9]*)([MIDNSHP=X])/g)];
 check(tokens.length<=256,`Too many CIGAR operations in ${context}.`);
 let query=0,reference=0,position=refStart;
 const blocks=[],counts={M:0,I:0,D:0,N:0,S:0,H:0,P:0,'=':0,X:0};
 for(const [,lengthText,op] of tokens){
  const n=number(lengthText,1,MAX_COORD,'CIGAR length');counts[op]+=n;
  if('MIS=X'.includes(op))query+=n;
  if('MDN=X'.includes(op))reference+=n;
  if('M=X'.includes(op))blocks.push({start:position,end:position+n});
  if('MDN=X'.includes(op))position+=n;
  check(Number.isSafeInteger(query)&&Number.isSafeInteger(reference)&&position<=MAX_COORD,'CIGAR coordinate overflow.');
 }
 check(reference>0,`Mapped SAM CIGAR must consume reference bases in ${context}.`);
 check(refStart+reference<=refLength,`SAM CIGAR exceeds declared reference length in ${context}.`);
 if(seqLength!==null)check(query===seqLength,`SAM SEQ length differs from query-consuming CIGAR operations in ${context}.`);
 return {blocks,counts,query,reference,opCount:tokens.length};
}
function unionBases(blocks){
 if(!blocks.length)return 0;
 blocks.sort((a,b)=>a.start-b.start||a.end-b.end);
 let covered=0,right=-1;
 for(const b of blocks){if(b.start>right){covered+=b.end-b.start;right=b.end;}else if(b.end>right){covered+=b.end-right;right=b.end;}}
 return covered;
}
function chart(values){
 const entries=Object.entries(values),max=Math.max(1,...entries.map(x=>x[1])),height=80+entries.length*35;
 const bars=entries.map(([name,count],i)=>{const w=580*count/max,y=45+i*35;return `<text x="190" y="${y+16}" text-anchor="end" font-size="12" fill="#324c5f">${xml(name)}</text><rect x="204" y="${y}" width="${w.toFixed(1)}" height="22" rx="3" fill="#387b92"/><text x="${Math.min(825,212+w)}" y="${y+16}" font-size="12" fill="#234">${count}</text>`}).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 ${height}" role="img" aria-label="Mapping quality distribution for primary mapped SAM alignments"><rect width="900" height="${height}" fill="white"/><text x="18" y="24" font-size="18" fill="#123">Primary mapped SAM alignment MAPQ bins</text>${bars}</svg>\n`;
}
export function samQualityControl(files){
 check(Object.keys(files).join(',')==='sam','SAM QC requires exactly one SAM file.');
 const input=files.sam,lines=textFromBuffer(input).split(/\r?\n/);
 if(lines.at(-1)==='')lines.pop();
 check(lines.length<=MAX_RECORDS+MAX_REFS+5000,'SAM has too many lines.');
 const references=new Map(),seenHeaders=new Set();let seenAlignment=false,operationCount=0,coveredBlocks=0;
 const summary={kind:'sam-qc',inputs:'user-provided',method:'Complete bounded SAM text-file record scan and CIGAR/FLAG/MAPQ audit; exact union of M/=/X aligned reference spans of primary mapped records',
  alignment_records:0,primary_mapped:0,primary_unmapped:0,secondary:0,supplementary:0,duplicate_flagged:0,qc_failed:0,
  paired_flagged:0,proper_pair_flagged:0,first_segment:0,last_segment:0,reverse_strand:0,
  mapped_primary_mapq_unknown:0,mapped_primary_mapq_zero:0,mapped_primary_mapq_30_plus:0,
  mapped_primary_mapq_mean:null,primary_aligned_reference_bases:0,primary_aligned_query_bases:0,
  total_reference_covered_bases:0,nm_tagged_primary:0,nm_edits_primary_total:0,reference_sequences:0,
  warnings:[]};
 const bins={'MAPQ 0':0,'MAPQ 1-9':0,'MAPQ 10-19':0,'MAPQ 20-29':0,'MAPQ 30-39':0,'MAPQ 40-59':0,'MAPQ 60-254':0,'MAPQ 255 (unknown)':0};
 const cigarTotals={M:0,I:0,D:0,N:0,S:0,H:0,P:0,'=':0,X:0};
 let mapqSum=0,mapqCount=0;
 for(let index=0;index<lines.length;index++){
  const line=lines[index],lineNumber=index+1;
  check(line.length<=100000,`SAM line ${lineNumber} is too long.`);
  if(!line.trim())continue;
  if(line.startsWith('@')){
   check(!seenAlignment,`SAM header occurs after alignment on line ${lineNumber}.`);
   const fields=line.split('\t'),tag=fields[0];
   check(/^@(HD|SQ|RG|PG|CO)$/.test(tag),`Invalid SAM header on line ${lineNumber}.`);
   if(tag==='@SQ'){
    const properties=fields.slice(1).map(f=>{const m=/^([A-Za-z][A-Za-z0-9]):(.+)$/.exec(f);check(m,`Malformed @SQ tag on line ${lineNumber}.`);return [m[1],m[2]]});
    const map=new Map(properties);check(map.size===properties.length,'Duplicate @SQ tags are invalid.');
    const sn=map.get('SN');check(typeof sn==='string'&&sn!=='*'&&sn.length<=180&&!/[\s\t\r\n]/.test(sn),'Invalid SAM @SQ reference name.');
    check(!references.has(sn),`Duplicate SAM reference name ${sn.slice(0,20)}.`);
    const length=number(map.get('LN')||'',1,MAX_COORD,'@SQ LN');
    references.set(sn,{name:sn,length,primary_records:0,mapq_known:0,mapq_sum:0,reference_aligned_bases:0,blocks:[]});
    check(references.size<=MAX_REFS,'Too many SAM reference sequences.');
   }else if(tag==='@HD'){check(!seenHeaders.has('HD'),'Duplicate SAM @HD header.');seenHeaders.add('HD')}
   continue;
  }
  seenAlignment=true;const f=line.split('\t');
  check(f.length>=11&&f.length<=75,`SAM line ${lineNumber} needs 11 mandatory columns and at most 64 tags.`);
  const [qname,flagText,rname,posText,mapqText,cigar,rnext,pnextText,tlenText,seq,qual]=f;
  check(qname.length>0&&qname.length<=254&&!/[\x00-\x20\x7f]/.test(qname),`Invalid QNAME on line ${lineNumber}.`);
  const flag=number(flagText,0,65535,`FLAG on line ${lineNumber}`),pos=number(posText,0,MAX_COORD,`POS on line ${lineNumber}`),mapq=number(mapqText,0,255,`MAPQ on line ${lineNumber}`);
  check(rname.length>0&&rname.length<=180&&rnext.length<=180,`Invalid reference field on line ${lineNumber}.`);
  number(pnextText,0,MAX_COORD,`PNEXT on line ${lineNumber}`);
  check(/^-?(?:0|[1-9][0-9]*)$/.test(tlenText)&&Math.abs(Number(tlenText))<=MAX_COORD,`Invalid TLEN on line ${lineNumber}.`);
  check(seq==='*'||(seq.length<=MAX_READ&&/^[A-Za-z=.]+$/.test(seq)),`Invalid SAM SEQ on line ${lineNumber}.`);
  check(qual==='*'||(seq!=='*'&&qual.length===seq.length&&/^[!-~]+$/.test(qual)),`Invalid SAM QUAL on line ${lineNumber}.`);
  check(!((flag&0x40)&&(flag&0x80)),`SAM flags both first and last segment on line ${lineNumber}.`);
  check((flag&0x1)||!(flag&(0x2|0x8|0x20|0x40|0x80)),`Unpaired SAM record has paired-only flags on line ${lineNumber}.`);
  check(!((flag&0x100)&&(flag&0x800)),`SAM secondary and supplementary flags conflict on line ${lineNumber}.`);
  summary.alignment_records++;
  check(summary.alignment_records<=MAX_RECORDS,'Too many SAM alignment records.');
  if(flag&0x100)summary.secondary++;
  if(flag&0x800)summary.supplementary++;
  if(flag&0x400)summary.duplicate_flagged++;
  if(flag&0x200)summary.qc_failed++;
  if(flag&0x1)summary.paired_flagged++;
  if(flag&0x2)summary.proper_pair_flagged++;
  if(flag&0x40)summary.first_segment++;
  if(flag&0x80)summary.last_segment++;
  if(flag&0x10)summary.reverse_strand++;
  const primary=!(flag&0x900),mapped=!(flag&0x4);
  if(primary&&!mapped)summary.primary_unmapped++;
  if(!mapped){
   // A SAM unmapped record can still contain a coordinate when coordinate-sorted.
   if(cigar!=='*')check(cigar.length<=4096&&/^(?:[1-9][0-9]*[MIDNSHP=X])+$/.test(cigar),`Invalid unmapped CIGAR on line ${lineNumber}.`);
   continue;
  }
  check(rname!=='*'&&references.has(rname),`Mapped SAM alignment refers to absent @SQ reference on line ${lineNumber}.`);
  const ref=references.get(rname);
  check(pos>=1&&pos<=ref.length&&cigar!=='*',`Mapped SAM record lacks a valid position or CIGAR on line ${lineNumber}.`);
  const parsed=readCigar(cigar,seq==='*'?null:seq.length,pos-1,ref.length,`line ${lineNumber}`);
  operationCount+=parsed.opCount;check(operationCount<=MAX_CIGAR_OPS,'Too many SAM CIGAR operations.');
  if(!primary)continue;
  summary.primary_mapped++;ref.primary_records++;
  summary.primary_aligned_reference_bases+=parsed.counts.M+parsed.counts['=']+parsed.counts.X;
  summary.primary_aligned_query_bases+=parsed.query;
  ref.reference_aligned_bases+=parsed.counts.M+parsed.counts['=']+parsed.counts.X;
  for(const op of Object.keys(cigarTotals))cigarTotals[op]+=parsed.counts[op];
  coveredBlocks+=parsed.blocks.length;check(coveredBlocks<=MAX_BLOCKS,'Over 250,000 aligned reference blocks; split the SAM input.');
  ref.blocks.push(...parsed.blocks);
  if(mapq===255){bins['MAPQ 255 (unknown)']++;summary.mapped_primary_mapq_unknown++}
  else{
   const band=mapq===0?'MAPQ 0':mapq<=9?'MAPQ 1-9':mapq<=19?'MAPQ 10-19':mapq<=29?'MAPQ 20-29':mapq<=39?'MAPQ 30-39':mapq<=59?'MAPQ 40-59':'MAPQ 60-254';
   bins[band]++;mapqSum+=mapq;mapqCount++;ref.mapq_sum+=mapq;ref.mapq_known++;
   if(mapq===0)summary.mapped_primary_mapq_zero++;
   if(mapq>=30)summary.mapped_primary_mapq_30_plus++;
  }
  let nmCount=0;
  for(const tag of f.slice(11)){
   if(!tag.startsWith('NM:'))continue;
   nmCount++;const m=/^NM:i:(0|[1-9][0-9]*)$/.exec(tag);
   check(m,`Malformed NM:i tag on line ${lineNumber}.`);
   summary.nm_edits_primary_total+=number(m[1],0,MAX_COORD,'NM edit count');
   summary.nm_tagged_primary++;
  }
  check(nmCount<=1,`Duplicate NM tags on line ${lineNumber}.`);
 }
 summary.reference_sequences=references.size;
 summary.mapped_primary_mapq_mean=mapqCount?Math.round(1000*mapqSum/mapqCount)/1000:null;
 const refRows=[];
 for(const ref of references.values()){
  const union=unionBases(ref.blocks);check(union<=ref.length,'Aligned coverage exceeds reference length.');
  summary.total_reference_covered_bases+=union;
  refRows.push([ref.name,ref.length,ref.primary_records,ref.reference_aligned_bases,union,
   (union/ref.length).toFixed(6),ref.mapq_known?(ref.mapq_sum/ref.mapq_known).toFixed(3):'NA']);
 }
 summary.warnings=[
  'SAM alignment records, not unique read names/fragments, are counted. Secondary and supplementary records are separate and excluded from primary mapping and coverage statistics.',
  'Reference coverage counts the union of primary mapped M/=/X CIGAR blocks only; deletions and skipped introns (D/N) are not covered; no base-level depth, mismatch calling, or sequence alignment was performed.',
  'MAPQ 255 means unavailable and is excluded from the mapped primary mean. MAPQ scales depend on the upstream aligner and are not calibrated probabilities.',
  'NM:i is an optional edit-distance annotation and includes differences/indels; it is not a validated base-error rate. No reference FASTA was accessed.',
  'SAM text and SAM.gz only, bounded to 12 MiB decoded. Binary BAM/CRAM are not decoded or falsely described as analyzed.',
  'No contamination, duplicate removal, sortedness verification, coordinate lifting, variant calling, or clinical interpretation was performed.'
 ];
 const provenance={schema:'genithm-sam-qc-provenance/1',engine:SAM_QC_VERSION,source_files:{sam:{bytes:input.byteLength,sha256:sha(input)}},
  generated_at_utc:new Date().toISOString(),method:summary.method,limitations:summary.warnings,
  compute_scope:'private consent-based Codespaces scientific worker; original SAM removed after run'};
 const outputs={
  'sam-mapping-qc.tsv':tsv([['metric','count'],...Object.entries(summary).filter(([k,v])=>typeof v==='number'||v===null).map(([k,v])=>[k,v===null?'NA':v])]),
  'sam-reference-coverage.tsv':tsv([['reference','declared_length','primary_mapped_records','aligned_M_equals_X_bases_total','covered_union_bp','covered_fraction','known_mean_mapq'],...refRows]),
  'sam-cigar-operations.tsv':tsv([['cigar_operation','total_bases_in_primary_mapped_records'],...Object.entries(cigarTotals)]),
  'sam-mapq.svg':chart(bins),
  'summary.json':json(summary),'provenance.json':json(provenance),
  'METHODS.md':'# Genithm SAM alignment quality control\n\n'+summary.method+'\n\nEvery value is measured from the complete supplied SAM text, not generated by an LLM. Original input SHA-256 and limits are in provenance.json.\n\n## Interpretation and limitations\n'+summary.warnings.map(x=>'- '+x).join('\n')+'\n'
 };
 return {summary,provenance,outputs};
}