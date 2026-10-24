#!/usr/bin/env node
/** V58: finite, auditable, real scientific computations for Genithm chat.
 * Inputs are explicitly supplied through the authenticated Codespaces runner,
 * or fetched from one pinned, published public RNA-seq example. No AI model
 * generates input values, statistics, gene IDs or result files.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './public_rice_gwas.mjs';
import { calculateGwas, gwasSummaryTsv } from '../apps/web/lib/gwas-association.ts';
import { analyzeExpression, expressionTsv, expressionGeneList } from '../apps/web/lib/expression-analysis.ts';
import { analyzePathways, pathwaysTsv } from '../apps/web/lib/pathway-enrichment.ts';
import { analyzeChatQc } from './chat_qc_engine.mjs';

export const CHAT_SCIENCE_VERSION = 'genithm-chat-science/1.1.0';
export const AIRWAY_SOURCE = Object.freeze({
  repository: 'bioconnector/workshops',
  revision: '68ff3e4868b0e5673a1c4399828a3e0adc72f8e4',
  paper: 'Himes et al. 2014 PLoS ONE 9(6):e99625, PMID 24926665',
  files: Object.freeze({
    'airway_rawcounts.csv': { bytes: 2297790, gitBlob: '086e0a4afc78ad218932f13d47b23debfdc99ce6' },
    'airway_metadata.csv': { bytes: 325, gitBlob: '8b2453c8b047d2011efa3b0660252834467e476c' },
  }),
});
const asHash = buf => createHash('sha256').update(buf).digest('hex');
const check = (value, explanation) => {if(!value) throw new Error(explanation);};
const safe = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric = value => Number.isFinite(value) ? Number(value).toPrecision(5) : 'NA';
/** Infer only a genuinely binary 0/1 phenotype, never assume that an ordinary
 * integer-valued quantitative trait is a case/control study. Researchers can
 * use the dedicated GWAS Lab to override or configure advanced models.
 */
export function inferGwasTraitKind(table){
 const lines=table.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
 const first=lines[0]||'',sep=first.includes('\t')?'\t':',';
 const fields=first.split(sep).map(x=>x.trim().toLowerCase());
 const col=fields.indexOf('phenotype');
 if(fields[0]!=='sample_id'||col<0)throw new Error('GWAS phenotype must start with sample_id and include phenotype column.');
 const values=lines.slice(1).map(line=>line.split(sep)[col]?.trim()).filter(x=>x && !['NA','.','N/A','-9'].includes(x));
 return values.length>=20 && values.every(x=>x==='0'||x==='1') &&
    values.includes('0') && values.includes('1') ? 'binary':'quantitative';
}
const json = data => JSON.stringify(data,null,2)+'\n';
const sha = (raw, label) => ({ label, bytes: raw.byteLength, sha256: asHash(raw) });
const utf8 = bytes => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const clip = (x,low,high)=> Math.max(low,Math.min(high,x));

/** No untrusted raw content is inserted into SVG; labels are escaped. */
export function scatterSvg({title,axisX,axisY,points,referenceY=null,chroms=[]}) {
  const w=1150,h=470,left=68,right=25,top=42,bottom=64,plotW=w-left-right,plotH=h-top-bottom;
  check(points.length>0,'No measured statistical points to plot.');
  const clean=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  check(clean.length>0,'Plot has no finite measurements.');
  const xmin=Math.min(...clean.map(x=>x.x)),xmax=Math.max(...clean.map(x=>x.x));
  const ymin=Math.min(0,...clean.map(x=>x.y)),ymax=Math.max(1,...clean.map(x=>x.y));
  const rangeX=Math.max(1e-8,xmax-xmin),rangeY=Math.max(1e-8,ymax-ymin);
  const px=x=>left+(x-xmin)/rangeX*plotW,py=y=>top+(ymax-y)/rangeY*plotH;
  const stride=Math.max(1,Math.ceil(clean.length/9000));
  const dots=clean.filter((p,i)=>i%stride===0||p.highlight).map(p=>`<circle cx="${px(p.x).toFixed(2)}" cy="${py(p.y).toFixed(2)}" r="${p.highlight?2.8:1.5}" fill="${p.highlight?'#c84255':p.color===1?'#247f91':'#3e6eb1'}"/>`).join('');
  const reference=Number.isFinite(referenceY)&&referenceY!==null?`<line x1="${left}" x2="${w-right}" y1="${py(clip(referenceY,ymin,ymax)).toFixed(2)}" y2="${py(clip(referenceY,ymin,ymax)).toFixed(2)}" stroke="#bc3650" stroke-dasharray="6 5"/>`:'';
  const labels=chroms.map(x=>`<text x="${px(x.x).toFixed(1)}" y="${h-40}" text-anchor="middle" font-size="12" fill="#39536b">${safe(x.label)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${safe(title)}"><rect width="${w}" height="${h}" fill="white"/><text x="${left}" y="24" font-family="system-ui,sans-serif" font-size="16" fill="#142c43">${safe(title)}</text><line x1="${left}" y1="${top}" x2="${left}" y2="${h-bottom}" stroke="#456"/><line x1="${left}" y1="${h-bottom}" x2="${w-right}" y2="${h-bottom}" stroke="#456"/>${reference}${dots}${labels}<text x="${w/2}" y="${h-12}" font-size="13" text-anchor="middle" fill="#345">${safe(axisX)}</text><text x="12" y="${top}" font-size="12" fill="#345">${safe(axisY)}</text><text x="${w-right-3}" y="${top+15}" font-size="11" text-anchor="end" fill="#789">n=${clean.length} measured points</text></svg>\n`;
}
export function manhattanPlot(result) {
  const grouped=new Map();for(const v of result.variants){const key=String(v.chrom);const arr=grouped.get(key)||[];arr.push(v);grouped.set(key,arr);}
  const chromosomes=[...grouped.keys()].sort((a,b)=>Number(a)-Number(b));
  let offset=0;const mid=[];const points=[];
  for(const [index,chr] of chromosomes.entries()){
    const variants=grouped.get(chr);const max=Math.max(...variants.map(v=>v.pos));
    mid.push({label:chr,x:offset+max/2});
    for(const v of variants)points.push({x:offset+v.pos,y:-Math.log10(Math.max(v.p,1e-300)),highlight:v.bonferroni<0.05,color:index%2});
    offset+=max+Math.max(100,Math.round(max*0.02));
  }
  return scatterSvg({title:'Genome-wide association: measured variants',axisX:'Chromosome',axisY:'−log10(P)',points,chroms:mid,referenceY:-Math.log10(.05/result.variantsTested)});
}
export function qqPlot(result) {
  const values=result.variants.map(v=>v.p).sort((a,b)=>a-b),n=values.length;
  return scatterSvg({title:'GWAS Q–Q: observed vs expected',axisX:'Expected −log10(P)',axisY:'Observed −log10(P)',points:values.map((p,i)=>({x:-Math.log10((i+.5)/n),y:-Math.log10(Math.max(p,1e-300)),color:0}))});
}
export function volcanoPlot(result) {
  return scatterSvg({title:'Exploratory RNA expression: Welch tests',axisX:'log2 normalized CPM fold change',axisY:'−log10(P)',points:result.genes.map(g=>({x:g.log2FoldChange,y:-Math.log10(Math.max(g.p,1e-300)),highlight:g.fdr<.05&&Math.abs(g.log2FoldChange)>=1}))});
}
export function samplePcaPlot(result) {
  return scatterSvg({title:'RNA expression sample QC: PCA',axisX:'PC1',axisY:'PC2',points:result.samples.map(s=>({x:s.pc1,y:s.pc2,color:s.group===result.referenceGroup?0:1}))});
}
export function pathwayPlot(result){
  const rows=result.pathways.filter(x=>x.overlap>0).slice(0,30);
  return scatterSvg({title:'Pathway over-representation: top hits',axisX:'Ranked gene set (top 30)',axisY:'−log10(P)',points:rows.map((r,i)=>({x:i+1,y:-Math.log10(Math.max(r.p,1e-300)),highlight:r.fdr<.05}))});
}

/** Public data are fetched only from these fixed, pinned, checksum-verified URLs. */
export async function fetchPublicAirway(fetcher=fetch){
  const names=Object.keys(AIRWAY_SOURCE.files);const out={};
  await Promise.all(names.map(async name=>{
    const spec=AIRWAY_SOURCE.files[name];
    const url=`https://raw.githubusercontent.com/${AIRWAY_SOURCE.repository}/${AIRWAY_SOURCE.revision}/data/${name}`;
    const response=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});
    check(response.ok&&response.url===url,`Public airway data download failed for ${name}.`);
    const length=Number(response.headers.get('content-length')||0);
    // Transport Content-Length may describe compressed HTTP bytes; the
    // decompressed original is checked exactly against git SHA1 and byte size.
    check(!length||length<=spec.bytes*4,`Public airway download is oversized for ${name}.`);
    const raw=Buffer.from(await response.arrayBuffer());
    check(raw.length===spec.bytes,`Unexpected public airway file bytes: ${name}.`);
    const gitBlob=createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
    check(gitBlob===spec.gitBlob,`Public airway source checksum mismatch for ${name}.`);
    out[name]={raw,url,gitBlob};
  }));
  return out;
}
/** Convert the published count header and metadata without fabricating counts. */
export function prepareAirway(countsCsv,metaCsv){
  const counts=countsCsv.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/);
  const first=counts[0].split(',').map(x=>x.replace(/^"|"$/g,'').trim());
  check(first.length===9 && /^(?:ensgene|gene_id|gene|""|)$/i.test(first[0]),'Airway count matrix columns changed.');
  const samples=first.slice(1);
  check(samples.length===8 && new Set(samples).size===8,'Airway RNA read-count sample list changed.');
  // The published airway matrix has more than 50k annotated genes.
  // Pre-filter using one prespecified biological count rule, never the
  // arbitrary first N rows. Retain >=10 raw reads in >=4 of 8 samples.
  const originalGenes=counts.length-1;
  const kept=counts.slice(1).filter((line,index)=>{
    const fields=line.split(',');
    check(fields.length===9,`Airway gene row ${index+2} has an invalid column count.`);
    const values=fields.slice(1).map(x=>x.trim());
    check(values.every(x=>/^\d+$/.test(x)),`Airway gene row ${index+2} does not contain integer read counts.`);
    return values.filter(x=>Number(x)>=10).length>=4;
  });
  check(kept.length>=20&&kept.length<=50000,'Public airway low-count filtering did not produce a valid <=50,000 gene count matrix.');
  const countsFiltered=[['gene_id',...samples].join(','),...kept];
  const sampleSheet=metaCsv.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/);
  const head=sampleSheet.shift().split(',').map(x=>x.trim());
  const idIdx=head.indexOf('id'),groupIdx=head.indexOf('dex');
  check(idIdx>=0 && groupIdx>=0,'Airway experimental design columns changed.');
  const design=new Map();
  for(const line of sampleSheet){const values=line.split(',').map(x=>x.trim());
    const id=values[idIdx],group=values[groupIdx];check(!design.has(id)&&['control','treated'].includes(group),'Invalid public airway sample design.');design.set(id,group);
  }
  check(samples.every(x=>design.has(x)) && design.size===8,'Public airway genotype/design sample mismatch.');
  return {countsText:countsFiltered.join('\n')+'\n',designText:'sample_id,condition\n'+samples.map(s=>`${s},${design.get(s)}`).join('\n')+'\n',originalGenes,prefilterRetained:kept.length};
}

/** Pure research operation: executes only a supported scientific engine. */
export function calculateChatStudy(kind, files, onProgress=()=>{}){
  if(['fastq-qc','vcf-qc','fasta-qc'].includes(kind))return analyzeChatQc(kind,files);
  const hashed=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes,name)]));
  const input={};for(const [name,bytes] of Object.entries(files))input[name]=utf8(bytes);
  const provenance={schema:'genithm-chat-science-provenance/1',engine:CHAT_SCIENCE_VERSION,created_at:new Date().toISOString(),kind,
    inputs:hashed,public_source:null,method:null,limitations:[]};
  const outputs={};let summary;
  const digest='0'.repeat(64);
  if(kind==='gwas'){
    check(input.genotypes&&input.phenotypes,'GWAS requires genotype and phenotype files.');
    const traitKind=inferGwasTraitKind(input.phenotypes);
    // Private uploads are explicitly opt-in. If ancestry PCs are absent,
    // the consent checkbox explains and acknowledges unadjusted exploratory
    // association; never invent PCs or pretend to run a mixed model.
    const result=calculateGwas(input.genotypes,input.phenotypes,{traitKind,minMaf:.05,maxMissing:.1,noCovariateAcknowledged:true},n=>onProgress('testing_variants',n));
    outputs['association.tsv']=gwasSummaryTsv(result,hashed.genotypes.sha256,hashed.phenotypes.sha256);
    outputs['manhattan.svg']=manhattanPlot(result);outputs['qq.svg']=qqPlot(result);
    summary={kind,method:result.associationMethod,inputs:'user-provided',samples:result.samplesMatched,variants_seen:result.variantsSeen,
      variants_tested:result.variantsTested,significant_bonferroni:result.significantBonferroni,
      top_associations:result.variants.slice().sort((a,b)=>a.p-b.p).slice(0,10).map(x=>({chr:x.chrom,pos:x.pos,id:x.id,p:x.p,fdr:x.fdr})),
      warnings:result.warnings};
    provenance.method=result.associationMethod;
  }else if(kind==='expression'||kind==='public-airway'){
    check(input.counts&&input.design,'RNA expression comparison requires raw counts and a matched sample design.');
    const result=analyzeExpression(input.counts,input.design,{minCpm:1,referenceGroup:kind==='public-airway'?'control':undefined},n=>onProgress('testing_genes',n));
    outputs['expression.tsv']=expressionTsv(result);
    outputs['significant_genes.txt']=expressionGeneList(result,true);
    outputs['measured_genes.txt']=expressionGeneList(result,false);
    outputs['sample_qc.tsv']=['sample_id\tcondition\tlibrary_size\tsize_factor\tPC1\tPC2',...result.samples.map(s=>[s.sampleId,s.group,s.librarySize,s.sizeFactor,s.pc1,s.pc2].join('\t'))].join('\n')+'\n';
    outputs['volcano.svg']=volcanoPlot(result);outputs['sample-pca.svg']=samplePcaPlot(result);
    summary={kind,method:result.method,inputs:kind==='public-airway'?'published-airway':'user-provided',samples:result.samplesMatched,
      genes_seen:result.genesSeen,genes_tested:result.genesTested,reference:result.referenceGroup,comparison:result.comparisonGroup,
      genes_fdr_below_0_05:result.genes.filter(g=>g.fdr<.05).length,
      top_genes:result.genes.slice().sort((a,b)=>a.p-b.p).slice(0,10).map(g=>({gene_id:g.geneId,p:g.p,fdr:g.fdr,log2fc:g.log2FoldChange})),
      warnings:result.warnings.concat('Exploratory normalized-CPM Welch analysis only, NOT DESeq2/edgeR negative-binomial inference. No paired donor or batch adjustment.')};
    provenance.method=result.method;
  }else if(kind==='pathways'){
    check(input.selected&&input.universe&&input.gmt,'Pathway over-representation requires selected genes, an explicit measured background, and GMT gene sets.');
    const result=analyzePathways(input.selected,input.universe,input.gmt,n=>onProgress('testing_sets',n));
    outputs['pathway-enrichment.tsv']=pathwaysTsv(result);outputs['enrichment.svg']=pathwayPlot(result);
    summary={kind,method:result.method,inputs:'user-provided',selected:result.inputSelectedGenes,universe:result.universeGenes,
      pathways_tested:result.eligibleSetsTested,pathways_fdr_below_0_05:result.pathways.filter(x=>x.fdr<.05).length,
      top_pathways:result.pathways.slice(0,10).map(x=>({name:x.name,p:x.p,fdr:x.fdr,overlap:x.overlap})),warnings:result.warnings};
    provenance.method=result.method;
  }else throw new Error('Unsupported scientific analysis requested.');
  provenance.limitations=summary.warnings;
  outputs['summary.json']=json(summary);
  outputs['provenance.json']=json(provenance);
  const meaning=kind==='public-airway'?'Published human airway smooth-muscle dexamethasone RNA-seq read counts':kind==='gwas'?'Matched genotype–phenotype GWAS':kind==='expression'?'Two-group raw RNA count-matrix comparison':'Gene-set over-representation with explicit measured universe';
  outputs['METHODS.md']=`# Genithm ${meaning}\n\nEngine: ${CHAT_SCIENCE_VERSION}\nMethod: ${summary.method}\n\nAll reported statistics were calculated from the verified input file bytes by the scientific analysis code, NOT by an LLM.\n\n## Limitations\n${summary.warnings.map(w=>'- '+w).join('\n')}\n\n## Reproducibility\nSHA-256 input fingerprints and versioned calculation details are in provenance.json. See full tabular results and research plots.\n`;
  return {summary,provenance,outputs};
}
export async function runChatStudy({kind,inputs,outDirectory,onProgress=()=>{},fetcher=fetch}){
  let data=inputs||{};let pub=null;
  if(kind==='public-airway'){
    check(Object.keys(data).length===0,'Published study must not combine with private research inputs.');
    onProgress('fetching_public_data',0);
    const source=await fetchPublicAirway(fetcher);
    const prepared=prepareAirway(utf8(source['airway_rawcounts.csv'].raw),utf8(source['airway_metadata.csv'].raw));
    data={counts:Buffer.from(prepared.countsText),design:Buffer.from(prepared.designText)};
    pub={repository:AIRWAY_SOURCE.repository,revision:AIRWAY_SOURCE.revision,paper:AIRWAY_SOURCE.paper,
      original_genes:prepared.originalGenes,genes_after_prefilter:prepared.prefilterRetained,
      prefilter:'At least 10 unnormalized raw counts in at least 4 of 8 samples',
      files:Object.fromEntries(Object.entries(source).map(([name,s])=>[name,{url:s.url,git_blob_sha1:s.gitBlob,...sha(s.raw,name)}]))};
  }
  const result=calculateChatStudy(kind,data,onProgress);
  if(pub){result.provenance.public_source=pub;result.summary.dataset='Himes et al. 2014 human airway RNA-seq: dexamethasone vs control';
    result.summary.public_source_genes=pub.original_genes;result.summary.prefilter_retained_genes=pub.genes_after_prefilter;result.summary.prefilter_rule=pub.prefilter;
    result.outputs['summary.json']=json(result.summary);
    result.outputs['provenance.json']=json(result.provenance);
    result.outputs['METHODS.md']+='\nPublic source: '+AIRWAY_SOURCE.paper+'; '+AIRWAY_SOURCE.repository+' at '+AIRWAY_SOURCE.revision+'\nImportant: 8 samples correspond to four paired cell lines; Welch method does not model pairing. Treat significance as exploratory only.\n';
    result.outputs['METHODS.md']+='\nPrespecified low-count filter: '+pub.prefilter+'. Original gene rows: '+pub.original_genes+'; retained: '+pub.genes_after_prefilter+'.\n';
  }
  result.outputs['complete-results.zip']=createZip(result.outputs);
  await mkdir(outDirectory,{recursive:true,mode:0o700});
  const hashes={};
  for(const [name,contents] of Object.entries(result.outputs)){
    const buf=Buffer.isBuffer(contents)?contents:Buffer.from(contents);
    check(buf.length>0&&buf.length<30_000_000,'Scientific result file size is invalid.');
    await writeFile(join(outDirectory,name),buf,{mode:0o600});hashes[name]=asHash(buf);
  }
  await writeFile(join(outDirectory,'result-manifest.json'),json({kind,version:CHAT_SCIENCE_VERSION,
    filenames:Object.keys(result.outputs),hashes,summary:result.summary}),{mode:0o600});
  onProgress('finished',Object.keys(result.outputs).length);
  return {summary:result.summary,hashes,provenance:result.provenance,files:Object.keys(result.outputs)};
}

function parseCli(args){const out={};for(let i=0;i<args.length;i+=2){check(['--kind','--inputs','--out'].includes(args[i])&&!out[args[i]],'Invalid CLI arguments');out[args[i]]=args[i+1];}
  check(out['--kind']&&out['--inputs']&&out['--out']&&args.length===6,'CLI requires kind, inputs path, output directory');return out;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=parseCli(process.argv.slice(2));const kind=args['--kind'];
    check(['gwas','expression','pathways','public-airway','fastq-qc','vcf-qc','fasta-qc'].includes(kind),'Unsupported public or uploaded analysis kind');
    const input={};if(kind!=='public-airway'){
      const names=kind==='gwas'?['genotypes','phenotypes']:kind==='expression'?['counts','design']:
        kind==='pathways'?['selected','universe','gmt']:kind==='fastq-qc'?['r1','r2']:
        kind==='vcf-qc'?['vcf']:['fasta'];
      for(const name of names){
        try{input[name]=await readFile(join(resolve(args['--inputs']),name+'.txt'));}
        catch(err){if(kind==='fastq-qc'&&name==='r2'&&err?.code==='ENOENT')continue;throw err;}
      }
    }
    await runChatStudy({kind,inputs:input,outDirectory:resolve(args['--out']),onProgress:(stage,count)=>process.stdout.write(JSON.stringify({stage,count})+'\n')});
  }catch(e){process.stderr.write('Genithm scientific worker failed: '+String(e?.message||e).slice(0,350)+'\n');process.exitCode=1;}
}
