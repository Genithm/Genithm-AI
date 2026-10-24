/** Genithm V61: real BED vs GFF3 overlap, private isolated deterministic science.
 * BED [start,end) is 0-based; GFF3 [start,end] is 1-based inclusive.
 */
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
export const GENOMIC_INTERVAL_VERSION='genithm-interval-overlap/1.0.0';
const MAX_BYTES=8*1024*1024,MAX_ROWS=50000,MAX_HITS=100000,MAX_COORD=10000000000;
const fail=x=>{throw new Error(x);};
const check=(ok,x)=>{if(!ok)fail(x);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const cell=x=>{let s=String(x??'').replace(/[\t\r\n\x00-\x1f]/g,' ');return /^[=+@]|^-(?!\d+(?:\.\d+)?$)/.test(s)?"'"+s:s;};
const tsv=rows=>rows.map(r=>r.map(cell).join('\t')).join('\n')+'\n';
const xml=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function decode(buf,label){
  check(Buffer.isBuffer(buf)&&buf.length>0&&buf.length<=MAX_BYTES,`${label} must be nonempty and no larger than 8 MiB.`);
  let raw=buf;
  if(buf[0]===31&&buf[1]===139){
    try{raw=gunzipSync(buf,{maxOutputLength:MAX_BYTES+1});}
    catch{fail(`${label} gzip is invalid or expands beyond 8 MiB.`);}
  }
  check(raw.length<=MAX_BYTES&&!raw.includes(0),`${label} contains binary or oversized input.`);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(raw).replace(/^\uFEFF/,'');}
  catch{fail(`${label} is not UTF-8 text.`);}
}
function unsigned(x,min,context){
  check(/^(0|[1-9]\d*)$/.test(x),`Invalid ${context}: expected unsigned integer.`);
  const n=Number(x);
  check(Number.isSafeInteger(n)&&n>=min&&n<=MAX_COORD,`Invalid ${context}: coordinate out of bounds.`);
  return n;
}
function chrom(x){check(/^[A-Za-z0-9_.:-]{1,180}$/.test(x),'Invalid contig name.');return x;}
function rows(x){
 const a=x.split(/\r?\n/);if(a.at(-1)==='')a.pop();
 check(a.length<=MAX_ROWS+20000,'Too many genomic interval lines.');
 return a;
}
export function parseBed(buf){
 const result=[];let n=0;
 for(const line of rows(decode(buf,'BED'))){
  n++;if(!line.trim()||line.startsWith('#')||line.startsWith('track ')||line.startsWith('browser '))continue;
  const c=line.split('\t');
  check(c.length>=3&&c.length<=12,`BED line ${n} requires 3-12 tab-separated columns.`);
  const start=unsigned(c[1],0,`BED start on line ${n}`),end=unsigned(c[2],1,`BED end on line ${n}`);
  check(end>start,`BED line ${n} has empty or reversed interval.`);
  result.push({chr:chrom(c[0]),start,end,line:n});
  check(result.length<=MAX_ROWS,'Too many BED intervals (max 50,000).');
 }
 check(result.length>0,'BED contains no intervals.');return result;
}
export function parseGff3(buf){
 const result=[];let n=0,version=false;
 for(const line of rows(decode(buf,'GFF3'))){
  n++;if(/^##FASTA(?:\s|$)/.test(line))break;
  if(/^##gff-version 3\s*$/.test(line)){version=true;continue;}
  if(!line.trim()||line.startsWith('#'))continue;
  check(version,'GFF3 requires ##gff-version 3 before features; GTF is not supported.');
  const c=line.split('\t');
  check(c.length===9,`GFF3 line ${n} requires exactly nine tab-separated columns.`);
  check(/^[A-Za-z0-9_:.-]{1,120}$/.test(c[2]),`Invalid GFF3 feature type on line ${n}.`);
  const start1=unsigned(c[3],1,`GFF3 start on line ${n}`),end1=unsigned(c[4],1,`GFF3 end on line ${n}`);
  check(end1>=start1,`GFF3 end precedes start on line ${n}.`);
  check(/^[+\-.?]$/.test(c[6])&&/^(?:\.|[012])$/.test(c[7]),`Bad GFF3 strand or phase on line ${n}.`);
  check(c[5]==='.'||(Number.isFinite(Number(c[5]))&&Number(c[5])>=0),`Bad GFF3 score on line ${n}.`);
  check(c[8].length<=4096,`GFF3 attributes exceed limit on line ${n}.`);
  const id=/(?:^|;)ID=([^;]+)/.exec(c[8])?.[1]||`gff-line-${n}`;
  check(id.length<=180,`GFF3 ID too long on line ${n}.`);
  result.push({chr:chrom(c[0]),start:start1-1,end:end1,start1,end1,type:c[2],id,line:n});
  check(result.length<=MAX_ROWS,'Too many GFF3 features (max 50,000).');
 }
 check(version&&result.length>0,'GFF3 has no valid features or lacks version 3 declaration.');
 return result;
}
/** Point-partitioned interval tree; never scan every feature for every query. */
function build(features){
 if(!features.length)return null;
 const starts=features.map(f=>f.start).sort((a,b)=>a-b);
 const pivot=starts[Math.floor(starts.length/2)],left=[],right=[],cross=[];
 for(const f of features){
  if(f.end<=pivot)left.push(f);
  else if(f.start>pivot)right.push(f);
  else cross.push(f);
 }
 check(cross.length>0,'Genomic index construction failed.');
 return {pivot,asc:cross.slice().sort((a,b)=>a.start-b.start||a.line-b.line),
  desc:cross.slice().sort((a,b)=>b.end-a.end||a.line-b.line),
  left:build(left),right:build(right)};
}
function intersect(node,start,end,out){
 if(!node)return;
 if(end<=node.pivot){for(const f of node.asc){if(f.start>=end)break;out.push(f);}intersect(node.left,start,end,out);}
 else if(start>=node.pivot){for(const f of node.desc){if(f.end<=start)break;out.push(f);}intersect(node.right,start,end,out);}
 else{out.push(...node.asc);intersect(node.left,start,end,out);intersect(node.right,start,end,out);}
}
function unionLength(regions){
 let count=0,chr='',right=-1;
 for(const r of regions.slice().sort((a,b)=>a.chr.localeCompare(b.chr)||a.start-b.start||a.end-b.end)){
  if(r.chr!==chr||r.start>right){count+=r.end-r.start;chr=r.chr;right=r.end;}
  else if(r.end>right){count+=r.end-right;right=r.end;}
 }
 check(Number.isSafeInteger(count),'Genomic union exceeds safe precision.');
 return count;
}
function plot(typeRows){
 const take=typeRows.slice(0,12),highest=Math.max(1,...take.map(r=>r[2])),h=Math.max(170,85+take.length*34);
 const bars=take.map((r,i)=>{
  const y=50+i*34,width=600*r[2]/highest;
  return `<text x="185" y="${y+16}" text-anchor="end" font-size="12" fill="#345">${xml(r[0])}</text>`+
   `<rect x="200" y="${y}" width="${width.toFixed(1)}" height="22" fill="#397a93" rx="2"/>`+
   `<text x="${Math.min(825,207+width)}" y="${y+16}" font-size="12" fill="#234">${r[2]}</text>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 ${h}" role="img" aria-label="BED intersection with GFF3 feature types"><rect width="900" height="${h}" fill="white"/><text x="20" y="26" font-size="18" fill="#123">GFF3 features overlapped by BED intervals</text>${bars}</svg>\n`;
}
export function genomicOverlapFromChat(files){
 check(Object.keys(files).sort().join(',')==='bed,gff3','Genomic overlap requires one BED and one GFF3 file.');
 const beds=parseBed(files.bed),features=parseGff3(files.gff3),indexes=new Map(),byType=new Map();
 for(const f of features){
  if(!indexes.has(f.chr))indexes.set(f.chr,[]);
  indexes.get(f.chr).push(f);
  if(!byType.has(f.type))byType.set(f.type,{total:0,featureLines:new Set(),bedLines:new Set(),regions:[]});
  byType.get(f.type).total++;
 }
 for(const [chr,group] of indexes)indexes.set(chr,build(group));
 const hits=[],regions=[],overlapBeds=new Set(),overlapFeatures=new Set();
 for(const bed of beds){
  const found=[];intersect(indexes.get(bed.chr),bed.start,bed.end,found);
  found.sort((a,b)=>a.line-b.line);
  for(const f of found){
   const start=Math.max(bed.start,f.start),end=Math.min(bed.end,f.end);
   if(end<=start)continue;
   check(hits.length<MAX_HITS,'Over 100,000 genomic intersections: split into smaller genomic regions.');
   hits.push([bed.line,bed.chr,bed.start,bed.end,f.id,f.type,f.start1,f.end1,start,end,end-start]);
   overlapBeds.add(bed.line);overlapFeatures.add(f.line);
   const region={chr:bed.chr,start,end};regions.push(region);
   const stat=byType.get(f.type);stat.featureLines.add(f.line);stat.bedLines.add(bed.line);stat.regions.push(region);
  }
 }
 const bedBp=unionLength(beds),overlapBp=unionLength(regions);
 check(overlapBp<=bedBp,'Genomic coverage invariant failed.');
 const byFeature=[...byType].map(([type,x])=>[type,x.total,x.featureLines.size,x.bedLines.size,unionLength(x.regions)])
  .sort((a,b)=>b[2]-a[2]||a[0].localeCompare(b[0]));
 const warnings=[
  'BED is zero-based half-open; GFF3 is one-based inclusive. Coordinates are converted before intersection.',
  'A coordinate overlap is not proof of gene regulation, expression, pathogenicity, or functional annotation.',
  'Genome assembly and contig naming must already agree. No liftover, strand filtering, or biological validation was performed.',
  'GFF3 feature rows are counted independently; multipart rows sharing an ID are not grouped.',
  'Overlap coverage is unioned across duplicated BED and nested GFF3 rows, preventing inflated base-pair coverage.'
 ];
 const summary={kind:'genomic-overlap',inputs:'user-provided',
  method:'Exact BED [start,end) and GFF3 [start-1,end) intersection using an indexed interval tree and unioned base-pair coverage',
  bed_intervals:beds.length,gff3_features:features.length,intersections:hits.length,
  bed_intervals_with_annotations:overlapBeds.size,gff3_rows_with_overlap:overlapFeatures.size,
  bed_union_bp:bedBp,annotation_overlap_union_bp:overlapBp,
  bed_coverage_fraction:bedBp?overlapBp/bedBp:0,
  matching_contigs:new Set(beds.map(b=>b.chr).filter(c=>indexes.has(c))).size,warnings};
 const provenance={schema:'genithm-interval-overlap-provenance/1',engine:GENOMIC_INTERVAL_VERSION,
  generated_at_utc:new Date().toISOString(),kind:summary.kind,method:summary.method,
  source_files:Object.fromEntries(Object.entries(files).map(([role,bytes])=>[role,{bytes:bytes.byteLength,sha256:sha(bytes)}])),
  limitations:warnings,compute_scope:'private Codespaces worker with explicit consent; originals deleted'};
 const outputs={
  'interval-overlaps.tsv':tsv([['bed_line','contig','bed_start0','bed_end0','gff3_id','gff3_type','gff_start1','gff_end1','overlap_start0','overlap_end0','overlap_bp'],...hits]),
  'coverage-by-feature.tsv':tsv([['gff3_type','feature_rows','rows_overlapped','bed_intervals_touched','overlap_union_bp'],...byFeature]),
  'genomic-overlaps.svg':plot(byFeature),
  'summary.json':json(summary),'provenance.json':json(provenance),
  'METHODS.md':'# Genithm genomic interval overlap\n\n'+summary.method+'\n\nAll intersections are calculated from user-provided files; no variant calling, gene prediction, liftover or external scientific database query was performed.\n\n## Limits\n'+warnings.map(w=>'- '+w).join('\n')+'\n'
 };
 return {summary,provenance,outputs};
}
