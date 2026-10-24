/** V58 file-driven science router. Only real compatible scientific data
 * triggers a computation; arbitrary files remain valid ordinary attachments.
 * No original research bytes leave the browser in this helper.
 */
import { isGwasExecutionRequest } from './gwas-chat-intent.ts';
import { matchLocalAnalysisRequest } from './local-analysis-intent.ts';
export type ChatScienceUploadKind = 'gwas'|'expression'|'pathways'|'fastq-qc'|'vcf-qc'|'fasta-qc'|'fastq-trim'|'orf-scan'|'genomic-overlap';
export type ChatScienceUpload = {kind:ChatScienceUploadKind;files:Record<string,File>};
const action=/\b(?:run|perform|analy[sz]e|compare|test|calculate|compute|execute|do|study|process)\b/i;
const question=/^(?:what|why|how|explain|teach|define)\b/i;
const header=(text:string)=>text.replace(/^\uFEFF/,'').split(/\r?\n/).find(line=>line.trim()&& !line.startsWith('##'))||'';
const sep=(line:string)=>line.includes('\t')?'\t':',';
export type ProposedChatScience = {kind:ChatScienceUploadKind;roles:Record<string,number>;error?:string};
/** Probe only 4 KiB, never inspect private source beyond the local browser. */
export function proposeChatScience(message:string,sources:Array<{filename:string;head:string;size:number;gzip?:boolean}>):ProposedChatScience|null{
  if(sources.length<1||sources.length>3)return null;
  if(question.test(message)&&!action.test(message))return null;
  // V59: a real FASTA, FASTQ or VCF is sufficient for bounded QC. Its
  // execution is independent from an unrelated GWAS/BLAST scientific request.
  const m=message.toLowerCase();
  const wantsGwas=isGwasExecutionRequest(message);
  const wantsOtherMethod=/\b(?:blast|alignment|phylogen|tree|annotation|protein properties|translate|assemble|variant calling|differential expression|rna[ -]?seq|transcriptom|quantif\w*|trim\w*|gwas)\b/i.test(m);
  const couldQc=/\b(?:qc|quality|check|inspect|stats?|summary|summari[sz]e|analy[sz]e|calculate|report|process|profile|characteri[sz]e|overview|n50|gc content)\b/i.test(m)||action.test(message);
  const wantsOverlap=/\b(?:overlap|overlaps|intersect|intersection|intersections|compare genomic intervals|annotate genomic intervals|feature coverage)\b/i.test(m);
  if(wantsOverlap && !wantsGwas && sources.length===2){
    const beds=sources.map((s,i)=>/\.bed(?:\.gz)?$/i.test(s.filename)?i:-1).filter(x=>x>=0);
    const gffs=sources.map((s,i)=>/\.gff3?(?:\.gz)?$/i.test(s.filename)?i:-1).filter(x=>x>=0);
    if(beds.length===1&&gffs.length===1&&beds[0]!==gffs[0])return {kind:'genomic-overlap',roles:{bed:beds[0],gff3:gffs[0]}};
    return {kind:'genomic-overlap',roles:{},error:'Attach exactly one BED and one GFF3 file to compare their genomic intervals.'};
  }
  const info=sources.map(s=>{
    const lower=s.filename.toLowerCase(),head=s.head.replace(/^\uFEFF/,'');
    const fastq=/\.(?:fastq|fq)(?:\.gz)?$/.test(lower)||(/^@[^\n]+\r?\n[ACGTNacgtn]+\r?\n\+/.test(head) && !s.gzip);
    const vcf=/\.vcf(?:\.gz)?$/.test(lower)||head.startsWith('##fileformat=VCFv4.');
    const fasta=/\.(?:fasta|fa|fna|faa)(?:\.gz)?$/.test(lower)||head.startsWith('>');
    return {fastq,vcf,fasta,lower,head};
  });
  // V60: when the user explicitly requests a transformation, execute that
  // real method rather than silently substituting FASTQ/FASTA QC.
  const wantsTrim=/\b(?:trim|trimming|preprocess|preprocessing|remove adapters?|adapter removal|clean (?:my |these )?reads?|quality filter)\b/i.test(m);
  const wantsOrf=/\b(?:orfs?|open reading frames?|six[ -]frame|find coding regions|predict (?:potential )?coding sequences|translate orfs?)\b/i.test(m);
  if(wantsTrim && !wantsGwas && sources.every((_,i)=>info[i].fastq)){
    if(sources.length===1)return {kind:'fastq-trim',roles:{r1:0}};
    if(sources.length===2){
      const mate=sources.map((src,i)=>{
        if(/(?:^|[_./-])R?1(?:[_.-]|$)/i.test(src.filename)||/^@\S+\/1(?:\s|\r?\n)/.test(info[i].head))return 1;
        if(/(?:^|[_./-])R?2(?:[_.-]|$)/i.test(src.filename)||/^@\S+\/2(?:\s|\r?\n)/.test(info[i].head))return 2;
        return 0;
      });
      if(mate.includes(1)&&mate.includes(2))return {kind:'fastq-trim',roles:{r1:mate.indexOf(1),r2:mate.indexOf(2)}};
      return {kind:'fastq-trim',roles:{},error:'Name paired read files R1 and R2 to preserve synchronized preprocessing.'};
    }
  }
  if(wantsOrf && !wantsGwas && sources.length===1 && info[0].fasta)
    return {kind:'orf-scan',roles:{fasta:0}};
  if(!wantsGwas&&!wantsOtherMethod&&couldQc){
    if(sources.length===1){
      const type=info[0].fastq?'fastq-qc':info[0].vcf?'vcf-qc':info[0].fasta?'fasta-qc':null;
      if(type)return {kind:type,roles:{[type==='fastq-qc'?'r1':type==='vcf-qc'?'vcf':'fasta']:0}};
    }
    if(sources.length===2&&info.every(x=>x.fastq)){
      const mate=sources.map((src,i)=>{
        const t=src.filename;
        if(/(?:^|[_./-])R?1(?:[_.-]|$)/i.test(t)||/^@\S+\/1(?:\s|\r?\n)/.test(info[i].head))return 1;
        if(/(?:^|[_./-])R?2(?:[_.-]|$)/i.test(t)||/^@\S+\/2(?:\s|\r?\n)/.test(info[i].head))return 2;
        return 0;
      });
      if(mate.includes(1)&&mate.includes(2))return {kind:'fastq-qc',roles:{r1:mate.indexOf(1),r2:mate.indexOf(2)}};
      return {kind:'fastq-qc',roles:{},error:'For paired FASTQ QC, name the two files R1 and R2 or use standard /1 and /2 read headers.'};
    }
  }
  if(sources.length<2)return null;
  const kind:ChatScienceUploadKind|null=isGwasExecutionRequest(message)?'gwas':matchLocalAnalysisRequest(message)==='expression'?'expression':
    matchLocalAnalysisRequest(message)==='pathway'?'pathways':null;
  if(!kind&&!action.test(message))return null;
  const types: string[]=sources.map(s=>{
    const h=header(s.head.trim()); const cols=h.split(sep(h)).map(x=>x.trim().toLowerCase());
    if(/^##fileformat=VCFv4/i.test(s.head)||h.startsWith('#CHROM\t'))return 'genotypes';
    if(cols.slice(0,3).join('|')==='chr|pos|snp')return 'genotypes';
    if(cols[0]==='sample_id' && cols[1]==='phenotype')return 'phenotypes';
    if(['gene_id','gene','geneid','ensgene'].includes(cols[0])&&cols.length>=7)return 'counts';
    if(cols[0]==='sample_id' && cols[1]==='condition')return 'design';
    if(s.filename.toLowerCase().endsWith('.gmt')&&h.split('\t').length>=3)return 'gmt';
    if(cols.length>=3&&h.includes('\t')&&cols[0]&&cols[1]&&!h.includes(','))return 'gmt';
    return 'list';
  });
  const inferred=types.includes('genotypes')||types.includes('phenotypes')?'gwas':types.includes('counts')||types.includes('design')?'expression':types.includes('gmt')?'pathways':null;
  const selected=kind||inferred;
  if(!selected)return null;
  // Explicit scientific intent wins; other unrelated attachments cannot
  // silently be mapped into a different method or submitted to the server.
  if(kind && inferred && kind!==inferred)return {kind,roles:{},error:`Your attachments resemble ${inferred} inputs, not ${kind}. Select matching files or change the analysis.`};
  const wanted: string[]=selected==='gwas'?['genotypes','phenotypes']:selected==='expression'?['counts','design']:['selected','universe','gmt'];
  if(sources.length!==wanted.length)return {kind:selected,roles:{},error:`${selected} requires exactly ${wanted.join(', ')} files in the same chat message.`};
  const roles:Record<string,number>={};
  if(selected==='gwas'||selected==='expression'){
    for(const name of wanted){const idx=types.indexOf(name);if(idx<0)return {kind:selected,roles:{},error:`Could not identify the ${name} input. Check that its first row uses the required scientific columns.`};roles[name]=idx;}
  }else{
    const idx=types.indexOf('gmt');if(idx<0)return {kind:selected,roles:{},error:'Provide a valid tab-delimited GMT pathway gene-set file.'};roles.gmt=idx;
    const others=sources.map((x,i)=>({...x,i})).filter(x=>x.i!==idx);
    const explicitSelected=others.find(x=>/(?:selected|significant|hit[s]?|degs?|query)/i.test(x.filename));
    const explicitUniverse=others.find(x=>/(?:background|universe|tested|measured|all[_-]?genes)/i.test(x.filename));
    if(explicitSelected&&explicitUniverse&&explicitSelected.i!==explicitUniverse.i){roles.selected=explicitSelected.i;roles.universe=explicitUniverse.i;}
    else{
      const ordered=others.slice().sort((a,b)=>a.size-b.size);
      if(ordered[0].size===ordered[1].size)return {kind:selected,roles:{},error:'Name the two gene lists selected_genes.txt and measured_universe.txt to avoid an ambiguous enrichment background.'};
      roles.selected=ordered[0].i;roles.universe=ordered[1].i;
    }
  }
  if(new Set(Object.values(roles)).size!==wanted.length)return {kind:selected,roles:{},error:'Input file roles overlap; attach distinct, matching study files.'};
  return {kind:selected,roles};
}
export async function identifyChatScienceFiles(message:string,files:File[]):Promise<ChatScienceUpload|{error:string}|null>{
  if(files.length<1||files.length>3)return null;
  const probes=await Promise.all(files.map(async file=>({filename:file.name,size:file.size,
    head:await file.slice(0,4096).text().catch(()=>'' ),
    gzip:(await file.slice(0,2).arrayBuffer().then(buffer=>{const b=new Uint8Array(buffer);return b[0]===31&&b[1]===139;}).catch(()=>false))})));
  const result=proposeChatScience(message,probes);
  if(!result)return null;if(result.error)return {error:result.error};
  return {kind:result.kind,files:Object.fromEntries(Object.entries(result.roles).map(([role,index])=>[role,files[index]]))};
}
