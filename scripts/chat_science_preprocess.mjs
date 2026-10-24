/** Genithm V60: real read preprocessing and six-frame ORF exploration.
 * Scientific transformations run only in the explicit-consent Codespaces worker.
 * All FASTQ validation is delegated to the existing V39 Phred+33/mate checker;
 * output includes real reads/protein sequences but is never sent to an LLM.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { analyzeFastqQc, MAX_FASTQ_BYTES } from '../apps/web/lib/fastq-quality-control.ts';
import { readQcText } from './chat_qc_engine.mjs';

export const PREPROCESS_VERSION = 'genithm-sequence-preprocess/1.0.0';
const MAX_FASTA_BYTES = 32*1024*1024;
const MAX_ORFS = 50_000;
const MAX_PROTEIN_RESIDUES = 5_000_000;
const ADAPTER_SEEDS = ['AGATCGGAAGAGC','AGATCGGAAGAGCG'];
const REDUCED_CODON = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',TCT:'S',TCC:'S',TCA:'S',TCG:'S',TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',TGT:'C',TGC:'C',TGA:'*',TGG:'W',
  CTT:'L',CTC:'L',CTA:'L',CTG:'L',CCT:'P',CCC:'P',CCA:'P',CCG:'P',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',ACT:'T',ACC:'T',ACA:'T',ACG:'T',AAT:'N',AAC:'N',AAA:'K',AAG:'K',AGT:'S',AGC:'S',AGA:'R',AGG:'R',
  GTT:'V',GTC:'V',GTA:'V',GTG:'V',GCT:'A',GCC:'A',GCA:'A',GCG:'A',GAT:'D',GAC:'D',GAA:'E',GAG:'E',GGT:'G',GGC:'G',GGA:'G',GGG:'G',
};
const check = (condition,message)=>{if(!condition)throw new Error(message);};
const sha = data=>createHash('sha256').update(data).digest('hex');
const json = object=>JSON.stringify(object,null,2)+'\n';
const neutral = value=>{const x=String(value??'').replace(/[\t\r\n\x00-\x1f]/g,' ');if(x==='+'||x==='-')return x;return /^[=+@]|^-(?!\d+(?:\.\d+)?$)/.test(x)?"'"+x:x;};
const tsv = rows=>rows.map(row=>row.map(neutral).join('\t')).join('\n')+'\n';
const svgEscape = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function histogramSvg(title,labels,values,axis){
  check(labels.length===values.length&&labels.length<=32,'Invalid scientific histogram.');
  const w=920,h=Math.max(260,88+labels.length*40),left=200,barWidth=w-left-92,maximum=Math.max(1,...values);
  const bars=labels.map((label,i)=>{
    const y=54+40*i,length=barWidth*values[i]/maximum;
    return `<text x="${left-12}" y="${y+17}" text-anchor="end" font-size="13" fill="#385268">${svgEscape(label)}</text>`+
    `<rect x="${left}" y="${y}" height="25" width="${length.toFixed(2)}" rx="3" fill="${i%2?'#348c95':'#386cb1'}"/>`+
    `<text x="${Math.min(w-35,left+length+8)}" y="${y+17}" font-size="12" fill="#385268">${values[i]}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${svgEscape(title)}"><rect width="${w}" height="${h}" fill="white"/><text x="${left}" y="27" font-size="17" fill="#123">${svgEscape(title)}</text>${bars}<text x="${w/2}" y="${h-17}" text-anchor="middle" font-size="12" fill="#345">${svgEscape(axis)}</text></svg>\n`;
}
function sourceHashes(files){return Object.fromEntries(Object.entries(files).map(([name,data])=>[name,{bytes:data.byteLength,sha256:sha(data)}]));}
function envelope(kind,files,method,summary,outputs,warnings){
  const provenance={schema:'genithm-preprocess-provenance/1',engine:PREPROCESS_VERSION,kind,
    generated_at_utc:new Date().toISOString(),source_files:sourceHashes(files),method,limitations:warnings,
    compute_scope:'private Codespaces scientific worker with explicit consent; original inputs deleted after run'};
  const full={...summary,kind,method,inputs:'user-provided',warnings};
  outputs['summary.json']=json(full);
  outputs['provenance.json']=json(provenance);
  outputs['METHODS.md']='# Genithm sequence processing\n\n'+method+'\n\nScientific source SHA-256 fingerprints are in provenance.json.\n'+
    'The execution worker performed these transformations on full validated source data, not on LLM text.\n\n'+
    '## Interpretation and limits\n'+warnings.map(w=>'- '+w).join('\n')+'\n';
  return {summary:full,provenance,outputs};
}
function readFastqRecords(text){
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  if(lines.at(-1)==='')lines.pop();
  return Array.from({length:lines.length/4},(_,i)=>({
    header:lines[4*i],sequence:lines[4*i+1].toUpperCase(),plus:lines[4*i+2],quality:lines[4*i+3],
  }));
}
function trimOne(read,options){
  const seq=read.sequence,qual=read.quality;
  let end=seq.length,adapterHit=false;
  for(const seed of options.adapterSeeds){const i=seq.indexOf(seed);if(i>=0&&i<end){end=i;adapterHit=true;}}
  const afterAdapter=end;
  // 3' sliding-window mean Q20 (default window 4). Trim one base per failed
  // window until the rightmost window meets the threshold or is exhausted.
  const window=options.window,threshold=options.minQuality;
  while(end>0){
    const low=Math.max(0,end-window),width=end-low;
    let score=0;for(let i=low;i<end;i++)score+=qual.charCodeAt(i)-33;
    if(score/width>=threshold)break;
    end--;
  }
  return {cut:end,adapterHit,adapterBases:seq.length-afterAdapter,qualityBases:afterAdapter-end,
    sequence:seq.slice(0,end),quality:qual.slice(0,end),header:read.header,plus:read.plus};
}
/** Deterministic fixed-parameter conservative FASTQ preprocessing.
 * It is not a replacement for Cutadapt/fastp or quality-aware alignments.
 * Exposes options only to code/tests; user prompts cannot override defaults.
 */
export function fastqTrimFromChat(files,custom={}){
  const names=Object.keys(files).sort().join(',');
  check(names==='r1'||names==='r1,r2','FASTQ preprocessing needs one read file or an exact R1/R2 pair.');
  const options={minQuality:20,window:4,minLength:30,adapterSeeds:ADAPTER_SEEDS};
  Object.assign(options,custom);
  check(Number.isSafeInteger(options.minQuality)&&options.minQuality>=0&&options.minQuality<=40 &&
    Number.isSafeInteger(options.window)&&options.window>=1&&options.window<=20 &&
    Number.isSafeInteger(options.minLength)&&options.minLength>=1&&options.minLength<=400 &&
    Array.isArray(options.adapterSeeds)&&options.adapterSeeds.length<=4 &&
    options.adapterSeeds.every(x=>/^[ACGT]{12,50}$/.test(x)),'Invalid fixed FASTQ preprocessing parameters.');
  const t1=readQcText(files.r1,MAX_FASTQ_BYTES).text;
  const t2=files.r2?readQcText(files.r2,MAX_FASTQ_BYTES).text:undefined;
  // The existing V39 parser rejects mismatched read IDs, order, invalid quality,
  // incomplete records, Phred != 33, unsupported symbols and out-of-scope reads.
  const before=analyzeFastqQc(t1,t2);
  const mate1=readFastqRecords(t1),mate2=t2?readFastqRecords(t2):null;
  const kept=[[],[]],summary={initial_reads:mate1.length,kept_reads:0,discarded_reads:0,
    adapter_trimmed_reads:0,quality_trimmed_reads:0,adapter_bases_removed:0,quality_bases_removed:0,
    kept_bases:0,mode:mate2?'paired':'single',params:{min_phred:options.minQuality,quality_window:options.window,
      min_length:options.minLength,exact_adapter_seeds:options.adapterSeeds},read_pairs_kept:null};
  let beforeBases=0;
  for(let i=0;i<mate1.length;i++){
    const pair=[trimOne(mate1[i],options),...(mate2?[trimOne(mate2[i],options)]:[])];
    beforeBases+=mate1[i].sequence.length+(mate2?mate2[i].sequence.length:0);
    for(const p of pair){if(p.adapterHit)summary.adapter_trimmed_reads++;if(p.qualityBases>0)summary.quality_trimmed_reads++;
      summary.adapter_bases_removed+=p.adapterBases;summary.quality_bases_removed+=p.qualityBases;}
    // Never break mate synchronization: discard entire pair if either mate
    // falls below the minimum length after adapter and quality trimming.
    if(pair.some(x=>x.sequence.length<options.minLength)){summary.discarded_reads++;continue;}
    summary.kept_reads++;
    for(let j=0;j<pair.length;j++){
      const p=pair[j];kept[j].push(`${p.header}\n${p.sequence}\n${p.plus}\n${p.quality}\n`);
      summary.kept_bases+=p.sequence.length;
    }
  }
  check(summary.kept_reads>0,'No FASTQ reads passed the fixed post-trim minimum length; consider an appropriate laboratory parameterized workflow.');
  summary.read_pairs_kept=mate2?summary.kept_reads:null;
  summary.bases_before=beforeBases;
  summary.bases_after=summary.kept_bases;
  summary.retention_percent=+(summary.kept_reads/mate1.length*100).toFixed(2);
  const after1=kept[0].join(''),after2=mate2?kept[1].join(''):undefined;
  const post=analyzeFastqQc(after1,after2);
  const outputs={'trimmed_R1.fastq.gz':gzipSync(Buffer.from(after1),{level:6})};
  if(after2!==undefined)outputs['trimmed_R2.fastq.gz']=gzipSync(Buffer.from(after2),{level:6});
  outputs['trimming-summary.tsv']=tsv([
    ['Metric','Measured value'],
    ...Object.entries(summary).filter(([k,v])=>typeof v!=='object').map(([k,v])=>[k,v]),
    ...Object.entries(options).filter(([k,v])=>typeof v!=='object').map(([k,v])=>[k,v]),
    ['phred_encoding','Phred+33'],
    ['q30_bases_before',before.reads.reduce((a,r)=>a+r.q30BaseCount,0)],
    ['q30_bases_after',post.reads.reduce((a,r)=>a+r.q30BaseCount,0)],
  ]);
  outputs['read-retention.svg']=histogramSvg('Read retention after exact-adapter and Q20 trimming',
    ['Kept single reads or pairs','Discarded single reads or pairs'],[summary.kept_reads,summary.discarded_reads],'Input read units');
  outputs['post-trim-qc.tsv']=tsv([['Read file','Reads retained','Bases retained','Mean quality','Q30 %'],
    ...post.reads.map((r,i)=>[i===0?'R1':'R2',r.readCount,r.baseCount,r.meanPhred,+(100*r.q30BaseCount/r.baseCount).toFixed(2)])]);
  const warnings=['Conservative exact 13-14-nt Illumina adapter-seed matching only; mismatched, incomplete or reverse-complement adapters may remain.',
    'Phred+33, Q20 3-prime sliding-window size 4 and minimum read length 30 are fixed protocol defaults.',
    'Paired-end mode discards both mates if either falls below the length cutoff; no read mapping, deduplication, reference alignment or contaminant screening.',
    'Original private read identifiers and sequences are present only in authenticated downloadable output files, not in AI model requests.'];
  return envelope('fastq-trim',files,
    'Whole-file Phred+33 validated reads; exact adapter-seed clipping then rightmost Q20 window-4 tail trim; retain reads length >=30 and synchronized mate pairs.',
    summary,outputs,warnings);
}
const complement={A:'T',C:'G',G:'C',T:'A',U:'A',R:'Y',Y:'R',S:'S',W:'W',K:'M',M:'K',B:'V',V:'B',D:'H',H:'D',N:'N'};
const STOP=new Set(['TAA','TAG','TGA']);
export function translateCodons(nucleotide){
  check(/^[ACGT]*$/.test(nucleotide) && nucleotide.length%3===0,'Translation requires a complete unambiguous nucleotide reading frame.');
  let out='';for(let i=0;i<nucleotide.length;i+=3){const c=REDUCED_CODON[nucleotide.slice(i,i+3)];check(c,'Unknown translation codon.');out+=c;}
  return out;
}
function reverseComplement(sequence){
  const input=Buffer.from(sequence,'ascii'),out=Buffer.allocUnsafe(input.length);
  for(let i=0;i<input.length;i++)out[input.length-i-1]=complement[String.fromCharCode(input[i])].charCodeAt(0);
  return out.toString('ascii');
}
export function scanOpenReadingFrames(text,opts={}){
  const minAa=opts.minAa??30;
  check(Number.isSafeInteger(minAa)&&minAa>=3&&minAa<=300,'Invalid minimum ORF protein length.');
  const raw=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  const contigs=[];let contig=null;
  const ids=new Set();
  for(const [index,row] of raw.entries()){
    const line=row.trim();if(!line)continue;
    if(line.startsWith('>')){
      const id=line.slice(1).trim().split(/\s+/)[0];
      check(id&&id.length<=180&&!ids.has(id)&&!/[\x00-\x20]/.test(id),'Missing, duplicate or unsafe FASTA contig ID near line '+(index+1)+'.');
      check(contigs.length<50000,'FASTA exceeds 50,000 contigs.');
      ids.add(id);contig={id,seq:''};contigs.push(contig);continue;
    }
    check(contig,'A nucleotide sequence precedes its FASTA header.');
    const uppercase=line.toUpperCase();
    check(/^[ACGTURYSWKMBDHVN]+$/.test(uppercase),'ORF discovery requires nucleotide FASTA, not proteins or unsupported symbols.');
    contig.seq+=uppercase.replaceAll('U','T');
    check(contig.seq.length<=MAX_FASTA_BYTES,'FASTA contig exceeds the complete-file nucleotide limit.');
  }
  check(contigs.length>0 && contigs.every(c=>c.seq.length>0),'ORF discovery requires at least one nonempty nucleotide FASTA sequence.');
  const results=[];let allBases=0,totalResidues=0,plus=0,minus=0;
  for(const contig of contigs){
    const L=contig.seq.length;allBases+=L;
    check(allBases<=MAX_FASTA_BYTES,'Input FASTA exceeds the bounded ORF genome size.');
    for(const [strand,sequence] of [['+',contig.seq],['-',reverseComplement(contig.seq)]]){
      for(let frame=0;frame<3;frame++){
        let start=-1;
        for(let i=frame;i+2<sequence.length;i+=3){
          const codon=sequence.slice(i,i+3);
          if(!/^[ACGT]{3}$/.test(codon)){start=-1;continue;}
          if(start<0 && codon==='ATG')start=i;
          if(!STOP.has(codon))continue;
          if(start>=0){
            const residues=(i-start)/3;
            if(residues>=minAa){
              const left=strand==='+'?start+1:L-(i+2);
              const right=strand==='+'?i+3:L-start;
              const protein=translateCodons(sequence.slice(start,i));
              check(!protein.includes('*')&&protein.length===residues,'Invalid translated ORF candidate.');
              totalResidues+=residues;
              check(results.length<MAX_ORFS && totalResidues<=MAX_PROTEIN_RESIDUES,
                'Too many candidate ORFs or translated residues for the bounded analysis.');
              const id=`orf${String(results.length+1).padStart(6,'0')}`;
              results.push({id,contig:contig.id,start:left,end:right,strand,frame:frame+1,
                nt_length:residues*3+3,aa_length:residues,stop_codon:codon,protein});
              if(strand==='+')plus++;else minus++;
            }
          }
          start=-1;
        }
      }
    }
  }
  return {results,stats:{contigs:contigs.length,nucleotides_analyzed:allBases,
    orfs:results.length,plus_strand_orfs:plus,minus_strand_orfs:minus,
    translated_residues:totalResidues,min_protein_length_aa:minAa,
    length_mean_aa:results.length?+(totalResidues/results.length).toFixed(2):0,
    longest_orf_aa:Math.max(0,...results.map(r=>r.aa_length))}};
}
export function orfDiscoveryFromChat(files){
  check(Object.keys(files).join(',')==='fasta','ORF exploration requires one nucleotide FASTA.');
  const text=readQcText(files.fasta,MAX_FASTA_BYTES).text;
  const {results,stats}=scanOpenReadingFrames(text);
  const tsvRows=[['ORF ID','Sequence ID','Strand','Frame','Start 1-based inclusive','End 1-based inclusive',
    'Nucleotide length incl stop','Amino acids excl stop','Stop codon'],
    ...results.map(r=>[r.id,r.contig,r.strand,r.frame,r.start,r.end,r.nt_length,r.aa_length,r.stop_codon])];
  const gff=['##gff-version 3',...results.map(r=>[encodeURIComponent(r.contig),'Genithm','putative_ORF',r.start,r.end,'.',r.strand,'.',
    `ID=${r.id};Name=${r.id};Note=unvalidated_six_frame_ORF`].join('\t'))].join('\n')+'\n';
  const faa=results.map(r=>`>${r.id} contig=${r.contig} strand=${r.strand} coords=${r.start}-${r.end} frame=${r.frame}\n${r.protein.match(/.{1,80}/g)?.join('\n')||''}\n`).join('');
  const bins=[[30,49],[50,99],[100,199],[200,499],[500,999],[1000,Infinity]];
  const bar=bins.map(([low,high])=>results.filter(r=>r.aa_length>=low && r.aa_length<=high).length);
  const output={
    'orfs.tsv':tsv(tsvRows),
    'orfs.gff3':gff,
    'proteins.faa':faa,
    'orf-lengths.svg':histogramSvg('Unvalidated six-frame ORFs by protein length',
      ['30-49 aa','50-99 aa','100-199 aa','200-499 aa','500-999 aa','1000+ aa'],bar,'Candidate ORFs'),
  };
  const warnings=['These are ATG-to-in-frame-stop ORF candidates, not experimentally validated genes or complete gene predictions.',
    'Standard genetic code (translation table 1), no alternative initiation codons, no splicing, RNA editing, frameshifts or circular-genome wraparound.',
    'For each frame, the first ATG after the preceding stop is chosen (longest start-to-stop interval). Nested start codons are not enumerated.',
    'Ambiguous nucleotide codons break candidate ORFs. Minimum 30 amino acids. True short genes and incomplete terminal ORFs may be missed.',
    'Unannotated ORFs may arise by chance; no homology, protein function or genomic annotation lookup was performed.'];
  return envelope('orf-scan',files,
    'Full bounded six-frame nucleotide scan for ATG-to-TAA/TAG/TGA candidates; standard code, min 30 aa, one longest start per stop-delimited frame interval.',
    stats,output,warnings);
}
export function analyzeSequenceProcessing(kind,files){
  if(kind==='fastq-trim')return fastqTrimFromChat(files);
  if(kind==='orf-scan')return orfDiscoveryFromChat(files);
  throw new Error('Unsupported sequence processing method.');
}
