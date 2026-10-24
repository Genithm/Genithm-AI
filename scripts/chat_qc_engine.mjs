/** Genithm V59: honest whole-file FASTQ/VCF/FASTA QC inside authenticated chat.
 * Original bytes never appear in the AI prompt. Imports already-tested V39
 * FASTQ and V38 VCF parsers rather than copying their scientific rules.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { analyzeFastqQc, MAX_FASTQ_BYTES } from '../apps/web/lib/fastq-quality-control.ts';
import { parseVcfQc, MAX_VCF_BYTES, QUALITY_LABELS, VARIANT_CATEGORIES } from '../apps/web/lib/vcf-quality-control.ts';

export const CHAT_QC_VERSION='genithm-chat-qc/1.0.0';
const MAX_FASTA_BYTES=32*1024*1024;
const MAX_FASTA_RECORDS=50000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const number=x=>Number.isFinite(x)?String(x):'NA';
const json=x=>JSON.stringify(x,null,2)+'\n';
function fail(message){throw new Error(message);}
function escapeXml(x){return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function tsvCell(value){const v=String(value??'').replace(/[\t\r\n\x00-\x1f]/g,' ');return /^[=+@]|^-(?!\d+(?:\.\d+)?(?:e[+-]?\d+)?$)/i.test(v)?"'"+v:v;}
const makeTsv=rows=>rows.map(row=>row.map(tsvCell).join('\t')).join('\n')+'\n';
const fingerprints=files=>Object.fromEntries(Object.entries(files).map(([role,bytes])=>[role,{sha256:hash(bytes),bytes:bytes.length}]));

/** Inspect signatures, not file extensions; decompression is explicitly capped.
 * Untrusted data never reaches external programs or provider APIs. */
export function readQcText(bytes,ceiling){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>ceiling)fail('Scientific QC input is empty or exceeds its bounded file limit.');
 let raw=bytes;
 const gzip=bytes[0]===0x1f&&bytes[1]===0x8b;
 if(gzip){
   try{raw=gunzipSync(bytes,{maxOutputLength:ceiling});}
   catch{fail('Compressed scientific input is invalid or expands beyond the safe complete-file limit.');}
 }
 if(raw.length<1||raw.length>ceiling)fail('Uncompressed research input exceeds the safe complete-file limit.');
 try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(raw),gzip};}
 catch{fail('Scientific QC requires valid UTF-8 FASTA/FASTQ/VCF content.');}
}

function barSvg(title,labels,counts,axis){
 const w=900,h=Math.max(280,100+labels.length*38),left=170,right=58,top=58;
 const max=Math.max(1,...counts),usable=w-left-right;
 const bars=labels.map((label,i)=>{
   const y=top+i*38,wide=counts[i]/max*usable;
   const color=i%2?'#267d91':'#416bab';
   return `<text x="${left-10}" y="${y+17}" font-size="12" fill="#345" text-anchor="end">${escapeXml(label)}</text>`+
     `<rect x="${left}" y="${y}" width="${wide.toFixed(2)}" height="24" fill="${color}" rx="3"/>`+
     `<text x="${Math.min(w-45,left+wide+9).toFixed(1)}" y="${y+17}" font-size="12" fill="#345">${counts[i]}</text>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(title)}"><rect width="${w}" height="${h}" fill="white"/><text x="${left}" y="30" font-size="19" fill="#123">${escapeXml(title)}</text>${bars}<text x="${w/2}" y="${h-18}" font-size="12" fill="#345" text-anchor="middle">${escapeXml(axis)}</text></svg>\n`;
}
function lineSvg(title,series){
 const w=1100,h=400,l=64,r=24,t=43,b=52,plotW=w-l-r,plotH=h-t-b;
 const cycleMax=Math.max(1,...series.map(s=>s.length));
 const ymax=Math.max(40,...series.flatMap(s=>s.map(x=>x[1])));
 const x=cycle=>l+(cycle-1)/Math.max(1,cycleMax-1)*plotW;
 const y=val=>t+(1-val/ymax)*plotH;
 const colors=['#416bab','#c65c3e'];
 const lines=series.map((s,i)=>`<polyline fill="none" stroke="${colors[i]}" stroke-width="2" points="${s.map((v,j)=>`${x(j+1).toFixed(2)},${y(v[1]).toFixed(2)}`).join(' ')}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(title)}"><rect width="${w}" height="${h}" fill="white"/><text x="${l}" y="26" font-size="18" fill="#123">${escapeXml(title)}</text><line x1="${l}" y1="${t}" x2="${l}" y2="${h-b}" stroke="#567"/><line x1="${l}" y1="${h-b}" x2="${w-r}" y2="${h-b}" stroke="#567"/>${lines}<text x="${w/2}" y="${h-15}" text-anchor="middle" font-size="13" fill="#345">Read cycle</text><text x="12" y="${t}" font-size="12" fill="#345">Mean Phred</text><text x="${w-r-10}" y="${t+15}" text-anchor="end" font-size="12" fill="#456">${series.length===2?'Blue: R1, Orange: R2':'Blue: R1'}</text></svg>\n`;
}
function computed(kind,rawInputs,method,summary,results,limitations){
 const provenance={schema:'genithm-chat-qc-provenance/1',engine:CHAT_QC_VERSION,kind,
   generated_at_utc:new Date().toISOString(),input_sha256:fingerprints(rawInputs),method,
   limitations,source_type:'private-file-upload-after-consent',
   validation:'All metrics computed on complete, bounded and format-validated source bytes; no AI estimates.'};
 const fullSummary={...summary,kind,method,inputs:'user-provided',warnings:limitations};
 results['summary.json']=json(fullSummary);
 results['provenance.json']=json(provenance);
 results['METHODS.md']='# Genithm scientific file quality control\n\n'+method+'\n\n'+
   `Engine: ${CHAT_QC_VERSION}\n\n`+
   'All reported metrics are computed from original source bytes, not model-generated outputs.\n'+
   'Input SHA-256 digests and exact byte lengths are in provenance.json.\n\n'+
   '## Boundaries\n'+limitations.map(x=>'- '+x).join('\n')+'\n';
 return {summary:fullSummary,provenance,outputs:results};
}

export function fastqQcFromChat(files){
 const names=Object.keys(files).sort();
 if(names.join(',')!=='r1'&&names.join(',')!=='r1,r2')fail('FASTQ QC requires one R1 file or exactly R1 and R2 mate files.');
 const t1=readQcText(files.r1,MAX_FASTQ_BYTES), t2=files.r2?readQcText(files.r2,MAX_FASTQ_BYTES):null;
 const result=analyzeFastqQc(t1.text,t2?.text);
 const rows=[['Mate','Reads','Bases','Mean length','Mean Phred+33','GC %','Q20 bases','Q30 bases','Q30 %','N %']];
 for(const [i,r] of result.reads.entries())rows.push([i?'R2':'R1',r.readCount,r.baseCount,r.meanLength,r.meanPhred,r.gcPercent??'undefined',r.q20BaseCount,r.q30BaseCount,+(r.q30BaseCount/r.baseCount*100).toFixed(2),r.nPercent]);
 rows.push([],['Mate','Cycle','Reads at cycle','Mean Phred+33','Q30 %']);
 for(const [i,r] of result.reads.entries())for(const [cycle,vals] of r.perCycle.entries())rows.push([i?'R2':'R1',cycle+1,...vals]);
 const allBases=result.reads.reduce((n,r)=>n+r.baseCount,0);
 const totalQ30=result.reads.reduce((n,r)=>n+r.q30BaseCount,0);
 const summary={mode:result.mode,encoding:'Phred+33',mates_validated:result.matesChecked,
   reads:result.reads.reduce((n,r)=>n+r.readCount,0),read_pairs:result.mode==='paired'?result.reads[0].readCount:null,
   bases:allBases,q30_percent:+(100*totalQ30/allBases).toFixed(2),
   per_mate:result.reads.map(r=>({reads:r.readCount,bases:r.baseCount,mean_length:r.meanLength,
     min_length:r.minLength,max_length:r.maxLength,mean_phred:r.meanPhred,gc_percent:r.gcPercent,n_percent:r.nPercent,
     q20_bases:r.q20BaseCount,q30_bases:r.q30BaseCount,length_bands:r.lengthBands,quality_bands:r.qualityBands}))};
 const method='Complete uncompressed or gzip FASTQ records; exact Phred+33 per-base decoding, all read-cycle means and paired-read identifier agreement.';
 const caveats=['Phred+33 encoding is assumed and validated, not automatically inferred.',
  'Read QC is not adapter trimming, alignment, variant calling, contaminant screening, or basecalling.',
  'Only complete files within the 12 MiB decompressed limit per mate are accepted.'];
 return computed('fastq-qc',files,method,summary,{
    'fastq-qc.tsv':makeTsv(rows),
    'quality-by-cycle.svg':lineSvg('FASTQ quality by sequencing cycle',result.reads.map(r=>r.perCycle)),
    'read-lengths.svg':barSvg('FASTQ read-length distribution',
      ['1-50','51-75','76-100','101-150','151-200','201-300','301-400'],
      result.reads[0].lengthBands.map((_,i)=>result.reads.reduce((n,r)=>n+r.lengthBands[i],0)),
      'Reads per length band'),
 },caveats);
}

export function vcfQcFromChat(files){
 if(Object.keys(files).join(',')!=='vcf')fail('VCF QC requires one VCF file.');
 const {text}=readQcText(files.vcf,MAX_VCF_BYTES);
 const v=parseVcfQc(text),s=v.summary;
 const rows=[['Metric','Measured value'],['Records',s.totalRecords],['Sample columns',s.sampleColumns],
   ['Transitions',s.transitions],['Transversions',s.transversions],
   ['Ti/Tv',s.transversions?+(s.transitions/s.transversions).toFixed(5):'undefined'],
   ['PASS',s.filterCounts.pass],['Filtered',s.filterCounts.filtered],['FILTER missing',s.filterCounts.missing],['QUAL missing',s.missingQual]];
 rows.push([],['Variant type','Count']);for(const k of VARIANT_CATEGORIES)rows.push([k,s.variantCounts[k]]);
 rows.push([],['QUALITY score band','Count']);for(const [i,label] of QUALITY_LABELS.entries())rows.push([label,s.qualityBins[i]]);
 rows.push([],['Chromosome/contig','Record count']);for(const r of s.chromCounts)rows.push([r.chrom,r.count]);
 const summary={variants:s.totalRecords,samples:s.sampleColumns,variants_by_type:s.variantCounts,
  filters:s.filterCounts,ti_tv:s.transversions?+(s.transitions/s.transversions).toFixed(5):null,
  quality_bands:s.qualityBins,chromosomes:s.distinctChromosomes};
 const method='Complete validated VCF v4 site-level QC, REF/ALT category counts, transition/transversion ratio, FILTER status and QUAL bins; GT genotypes are NOT analyzed.';
 return computed('vcf-qc',files,method,summary,{
   'vcf-qc.tsv':makeTsv(rows),
   'variant-types.svg':barSvg('VCF record categories',VARIANT_CATEGORIES.map(String),VARIANT_CATEGORIES.map(k=>s.variantCounts[k]),'Variant records'),
 },['No pathogenicity prediction, clinical interpretation, annotation, or variant calling.',
 'Sample columns are counted but their genotypes, depth and quality are not assessed.',
 'Only complete VCF v4 within the 8 MiB decompressed size limit is analyzed.']);
}

const DNA=/^[ACGTRYSWKMBDHVNU]+$/;
const PROTEIN=/^[ACDEFGHIKLMNPQRSTVWYXBZJUO*]+$/;
function nx(lengths,threshold){
 const sorted=lengths.slice().sort((a,b)=>b-a);const total=sorted.reduce((a,b)=>a+b,0);
 let cumul=0;for(let i=0;i<sorted.length;i++){
  cumul+=sorted[i];if(cumul>=total*threshold)return {n:sorted[i],l:i+1};
 }return {n:0,l:0};
}
export function parseFastaResearch(text){
 if(typeof text!=='string'||!text.length||Buffer.byteLength(text)>MAX_FASTA_BYTES||text.includes('\0'))fail('FASTA is empty, malformed or exceeds the 32 MiB complete-file limit.');
 const records=[];let current=null,alphabet='nucleotide';
 const baseCounts={A:0,C:0,G:0,T:0,U:0,N:0},proteinCounts={};
 let letterCount=0,ambiguous=0,proteinLetters=false;
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
 for(const [i,original] of lines.entries()){
   const line=original.trim();if(!line)continue;
   if(line.startsWith('>')){
     const name=line.slice(1).trim().split(/\s+/)[0];
     if(!name||name.length>250||/[\x00-\x1f]/.test(name))fail('FASTA header is missing or invalid near line '+(i+1)+'.');
     if(records.length>=MAX_FASTA_RECORDS)fail('FASTA exceeds 50,000 complete records.');
     current={id:name,length:0,gc:0,n:0,ambiguous:0};records.push(current);
     continue;
   }
   if(!current)fail('FASTA sequence appears before its header at line '+(i+1)+'.');
   const s=line.toUpperCase();
   if(!PROTEIN.test(s))fail('FASTA contains unsupported sequence symbols at line '+(i+1)+'.');
   if(!DNA.test(s))proteinLetters=true;
   current.length+=s.length;
   if(current.length>MAX_FASTA_BYTES)fail('FASTA record exceeds bounded sequence length.');
   for(let j=0;j<s.length;j++){
     const b=s[j];proteinCounts[b]=(proteinCounts[b]||0)+1;
     if(b in baseCounts)baseCounts[b]++;
     if(b==='G'||b==='C')current.gc++;
     if(b==='N')current.n++;
     if(!'ACGTU'.includes(b))current.ambiguous++;
   }
   letterCount+=s.length;
 }
 if(!records.length||records.some(r=>r.length===0))fail('FASTA must contain at least one nonempty sequence per record.');
 alphabet=proteinLetters?'protein':'nucleotide (inferred from symbols)';
 const lengths=records.map(r=>r.length),total=lengths.reduce((a,b)=>a+b,0);
 const n50=nx(lengths,.5),n90=nx(lengths,.9);
 const sorted=lengths.slice().sort((a,b)=>b-a);
 const known=baseCounts.A+baseCounts.C+baseCounts.G+baseCounts.T+baseCounts.U;
 const summary={molecule_type:alphabet,records:records.length,total_residues:total,
  shortest_sequence:sorted.at(-1),longest_sequence:sorted[0],mean_length:+(total/records.length).toFixed(2),
  median_length:sorted.length%2?sorted[Math.floor(sorted.length/2)]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2,n50:n50.n,l50:n50.l,n90:n90.n,l90:n90.l,
  gc_percent:!proteinLetters&&known?+(100*(baseCounts.G+baseCounts.C)/known).toFixed(3):null,
  ambiguous_percent:!proteinLetters?+(100*ambiguous/total).toFixed(3):null,
  n_bases:!proteinLetters?baseCounts.N:null,
  amino_acid_counts:proteinLetters?proteinCounts:null};
 return {summary,records,baseCounts};
}
export function fastaQcFromChat(files){
 if(Object.keys(files).join(',')!=='fasta')fail('FASTA statistics require exactly one nucleotide or protein FASTA.');
 const {text}=readQcText(files.fasta,MAX_FASTA_BYTES);
 const {summary,records}=parseFastaResearch(text);
 const rows=[['Sequence ID','Length','G/C residues','N bases','Ambiguous non-ACGT residues'],...records.map(r=>[r.id,r.length,r.gc,r.n,r.ambiguous])];
 const lengths=records.map(r=>r.length).sort((a,b)=>b-a);
 const rank=lengths.slice(0,30);
 const method='Complete FASTA parsing with exact record lengths, nucleotide composition and N50/L50/N90/L90 length statistics; protein alphabets detected heuristically.';
 return computed('fasta-qc',files,method,summary,{
   'fasta-stats.tsv':makeTsv(rows),
   'sequence-lengths.svg':barSvg('Longest FASTA sequences',rank.map((_,i)=>String(i+1)),rank,'Length in residues'),
 },['Molecule type is inferred from sequence symbols, not independently verified against a taxonomy or annotation database.',
 'N50/L50 describe sequence length distributions and do not validate assembly correctness or completeness.',
 'No genomic alignment, protein annotation, pathogenicity assessment or assembly was executed.']);
}
export function analyzeChatQc(kind,files){
 if(kind==='fastq-qc')return fastqQcFromChat(files);
 if(kind==='vcf-qc')return vcfQcFromChat(files);
 if(kind==='fasta-qc')return fastaQcFromChat(files);
 fail('Unrecognized scientific QC analysis.');
}
