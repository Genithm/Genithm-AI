/** V58 file-driven science router. Only real compatible scientific data
 * triggers a computation; arbitrary files remain valid ordinary attachments.
 * No original research bytes leave the browser in this helper.
 */
import { isGwasExecutionRequest } from './gwas-chat-intent.ts';
import { matchLocalAnalysisRequest } from './local-analysis-intent.ts';
export type ChatScienceUploadKind = 'gwas'|'expression'|'pathways';
export type ChatScienceUpload = {kind:ChatScienceUploadKind;files:Record<string,File>};
const action=/\b(?:run|perform|analy[sz]e|compare|test|calculate|compute|execute|do|study|process)\b/i;
const question=/^(?:what|why|how|explain|teach|define|summarize)\b/i;
const header=(text:string)=>text.replace(/^\uFEFF/,'').split(/\r?\n/).find(line=>line.trim()&& !line.startsWith('##'))||'';
const sep=(line:string)=>line.includes('\t')?'\t':',';
export type ProposedChatScience = {kind:ChatScienceUploadKind;roles:Record<string,number>;error?:string};
/** Probe only 4 KiB, never inspect private source beyond the local browser. */
export function proposeChatScience(message:string,sources:Array<{filename:string;head:string;size:number}>):ProposedChatScience|null{
  if(sources.length<2||sources.length>3)return null;
  if(question.test(message)&&!action.test(message))return null;
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
  if(files.length<2||files.length>3)return null;
  const probes=await Promise.all(files.map(async file=>({filename:file.name,size:file.size,
    head:await file.slice(0,4096).text().catch(()=>'' )})));
  const result=proposeChatScience(message,probes);
  if(!result)return null;if(result.error)return {error:result.error};
  return {kind:result.kind,files:Object.fromEntries(Object.entries(result.roles).map(([role,index])=>[role,files[index]]))};
}
