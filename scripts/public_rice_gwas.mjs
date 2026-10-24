#!/usr/bin/env node
/**
 * Genithm V57: reproducible, genuine public Oryza sativa GWAS.
 * Pinned, published Rice Diversity Panel (Zhao et al. 2011) downloaded only
 * from trusted immutable GitHub raw URLs. Never uses model-generated data.
 * No untrusted paths, arbitrary shell commands, credentials or uploads.
 * This script runs in a bounded Node child process and writes private files.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { calculateGwas, gwasManhattanOrder, gwasSummaryTsv } from '../apps/web/lib/gwas-association.ts';

export const DATA_REVISION = 'd83cc64f993f8a86485d30f715381b3c613e3d69';
export const DATA_REPOSITORY = 'rladiestunis/R4Bioinfo-series-workshop-Introduction-to-GWAS';
export const ENGINE = 'genithm-public-rice-gwas/1.0.0';
export const DATA_FILES = Object.freeze({
  'sativas413.ped': { max: 65_000_000, gitBlob: 'a2fb3454e91a2c2cfdd6361f55cae2ef67d1912f' },
  'sativas413.map': { max: 1_000_000, gitBlob: '8c645b51b7a9977db38e5ca34b492943ef1a779b' },
  'sativas413.pheno': { max: 200_000, gitBlob: '70722e50f72bfd8479a1587eac35f9ba4b5fe519' },
  'sativas413.csv': { max: 100_000, gitBlob: 'e6e4584297ef5cddcb21fa2c9e1f0ae5238c535b' },
});
const FILE_ORDER = ['sativas413.ped','sativas413.map','sativas413.pheno','sativas413.csv'];
const MISSING = new Set(['', 'NA', 'N/A', '.', '-9']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const lines = value => value.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter(line => line.trim().length > 0);
const safeInt = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const number = raw => MISSING.has(raw) ? null : (/^-?\d+(\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null);
function check(condition, message) { if (!condition) throw new Error(message); }
function emitProgress(stage, data = {}) { process.stdout.write(JSON.stringify({ stage, ...data }) + '\n'); }

async function downloadSource(name, fixtureDirectory = null) {
  const spec = DATA_FILES[name]; check(spec, 'Unrecognized source');
  let body;
  const url = `https://raw.githubusercontent.com/${DATA_REPOSITORY}/${DATA_REVISION}/${name}`;
  if (fixtureDirectory) {
    body = await readFile(join(fixtureDirectory, name));
  } else {
    const response = await fetch(url, { redirect:'error', cache:'no-store', signal:AbortSignal.timeout(120000), headers:{'Accept':'application/octet-stream'} });
    check(response.ok && response.url === url, `${name}: published source could not be downloaded (${response.status})`);
    const declared = Number(response.headers.get('content-length') || '0');
    check(!declared || declared <= spec.max, `${name}: published source exceeds byte ceiling`);
    check(response.body, `${name}: empty response stream`);
    let total = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      check(total <= spec.max, `${name}: downloaded bytes exceed ceiling`);
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks);
  }
  check(body.length > 0 && body.length <= spec.max, `${name}: empty or oversized dataset`);
  const gitBlob = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  if (!fixtureDirectory) check(gitBlob === spec.gitBlob, `${name}: source Git object checksum did not match pinned publication`);
  return { buffer:body, url, bytes:body.length, sha256:sha256(body), git_blob_sha1:gitBlob };
}

function parseMap(content) {
  const result = lines(content).map((line,index) => {
    const cols = line.trim().split(/\s+/);
    check(cols.length === 4 && /^(?:[1-9]|1[0-2])$/.test(cols[0]) && /^[-\w.]{1,100}$/.test(cols[1]) && safeInt(cols[3]), `Invalid rice marker position at line ${index+1}`);
    return { chr:cols[0], id:cols[1], pos:Number(cols[3]) };
  });
  check(result.length>=20 && result.length<=50000, 'Invalid marker count');
  return result;
}
function parsePhenotypes(content) {
  const rows = lines(content); const header = rows.shift()?.split('\t') || [];
  const idAt = header.indexOf('NSFTVID'), traitAt = header.indexOf('Plant height');
  check(idAt>=0 && traitAt>=0, 'Published rice phenotype column names have changed');
  const map = new Map();
  for (const [i,line] of rows.entries()) {
    const cells=line.split('\t');const id=cells[idAt]?.trim(), trait=number(cells[traitAt]?.trim()||'');
    check(id && safeInt(id) && !map.has(id), `Invalid or duplicate phenotype accession at row ${i+2}`);
    map.set(id, trait);
  }
  return map;
}
function parsePopulation(content) {
  const rows = lines(content); const start = rows.findIndex(line => /^GSOR ID,IRGC ID,NSFTV\.ID,/.test(line));
  check(start >= 0, 'Published population-PC header not found');
  const header = rows[start].split(',');
  const idAt=header.indexOf('NSFTV.ID'), pcs=['PC1','PC2','PC3'].map(name=>header.indexOf(name));
  check(idAt>=0 && pcs.every(x=>x>=0), 'Rice population covariates missing');
  const map=new Map();
  for (const row of rows.slice(start+1)) {
    const values=row.split(',');const id=values[idAt]?.trim();
    if (!id || !safeInt(id)) continue;
    const cov=pcs.map(i=>number(values[i]?.trim()||''));
    if (cov.every(x=>x!==null) && !map.has(id)) map.set(id,cov);
  }
  return map;
}

/** Correct PLINK PED: six pedigree fields then two allele tokens per marker. */
function parsePed(content, markers, phenotype, population) {
  const rows=lines(content);const samples=[];const seen=new Set();
  const refs=Array(markers.length).fill(null), alts=Array(markers.length).fill(null);
  const invalid=new Uint8Array(markers.length);
  const sampleVectors=[];
  for(const [rowIndex,line] of rows.entries()){
    const tokens=line.trim().split(/\s+/);
    check(tokens.length === 6+markers.length*2, `Rice PED record ${rowIndex+1} does not match the published marker map`);
    const id=tokens[1];check(safeInt(id) && !seen.has(id), `Duplicate or invalid rice accession in PED row ${rowIndex+1}`);seen.add(id);
    const y=phenotype.get(id), pcs=population.get(id);
    if (y===null || y===undefined || !pcs) continue;
    const gene=new Uint8Array(markers.length);gene.fill(255);
    for(let m=0;m<markers.length;m++){
      const a=tokens[6+m*2]?.toUpperCase(),b=tokens[7+m*2]?.toUpperCase();
      if(!a||!b || a==='0'||b==='0'||a==='N'||b==='N')continue;
      check(/^(?:[ACGT]|[12])$/.test(a) && /^(?:[ACGT]|[12])$/.test(b),`Unsupported allele encoding at row ${rowIndex+1}, marker ${m+1}`);
      for(const allele of [a,b]){
        if(refs[m]===null)refs[m]=allele;
        else if(refs[m]!==allele && alts[m]===null)alts[m]=allele;
        else if(refs[m]!==allele && alts[m]!==allele)invalid[m]=1;
      }
      gene[m]=((a!==refs[m])?1:0)+((b!==refs[m])?1:0);
    }
    samples.push({id, trait:y, covariates:pcs}); sampleVectors.push(gene);
  }
  check(rows.length>=20 && samples.length>=20, `Insufficient rice phenotype–genotype matches (${samples.length})`);
  return {samples, sampleVectors, invalid, totalPed:rows.length};
}

function fmt(v) { return String(Number.isFinite(v)?v:'NA'); }
function plotManhattan(result) {
  const full=result.variants.slice().sort(gwasManhattanOrder);
  const chr=[...new Set(full.map(x=>x.chrom))];const offsets=new Map();let cur=0;
  for(const c of chr){const subset=full.filter(v=>v.chrom===c);const max=Math.max(...subset.map(v=>v.pos));offsets.set(c,{start:cur,end:cur+max});cur+=max+Math.max(1,Math.round(max*.035));}
  const width=1180,height=430,left=60,right=25,top=30,bottom=62,plotW=width-left-right,plotH=height-top-bottom;
  const values=full.map(v=>-Math.log10(Math.max(v.p,1e-300)));const maxY=Math.max(8,Math.min(100,Math.ceil(Math.max(...values)+1)));
  const stride=Math.max(1,Math.ceil(full.length/6000));
  const strongest=new Set(full.slice().sort((a,b)=>a.p-b.p).slice(0,300).map(v=>v.id));
  const selected=full.filter((v,i)=>i%stride===0 || strongest.has(v.id));
  const escaped=text=>String(text).replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]));
  const x=v=>left+(offsets.get(v.chrom).start+v.pos)/cur*plotW;
  const y=p=>top+plotH*(1-Math.min(maxY,-Math.log10(Math.max(p,1e-300)))/maxY);
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Rice plant-height GWAS Manhattan plot">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/><text x="${left}" y="20" font-size="15" fill="#162641">Oryza sativa | Plant height | ${result.variantsTested} tested SNPs | published panel</text>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${top+plotH}" stroke="#45546c"/>`,
    `<line x1="${left}" y1="${top+plotH}" x2="${left+plotW}" y2="${top+plotH}" stroke="#45546c"/>`,
    `<line x1="${left}" y1="${y(5e-8)}" x2="${left+plotW}" y2="${y(5e-8)}" stroke="#c84961" stroke-dasharray="4 5"/>`,
    `<text x="12" y="24" font-size="12" fill="#445">-log10 P</text>`];
  for(let n=0;n<=maxY;n+=Math.max(1,Math.ceil(maxY/8))){parts.push(`<text x="${left-30}" y="${y(10**-n)+4}" font-size="11" fill="#556">${n}</text>`);}
  for(let i=0;i<chr.length;i++){const c=chr[i];const of=offsets.get(c);parts.push(`<text x="${left+(of.start+of.end)/2/cur*plotW}" y="${height-31}" font-size="11" text-anchor="middle" fill="#445">${escaped(c)}</text>`);}
  for(const v of selected){const color=v.bonferroni<.05?'#b52448':chr.indexOf(v.chrom)%2?'#278e97':'#396cae';parts.push(`<circle cx="${x(v).toFixed(2)}" cy="${y(v.p).toFixed(2)}" r="${v.bonferroni<.05?2.4:1.4}" fill="${color}"/>`);}
  parts.push(`<text x="${width/2}" y="${height-10}" font-size="12" text-anchor="middle" fill="#445">Rice chromosome (12 total) | red dashed line: conventional P = 5e-8</text>`,`</svg>`);
  return parts.join('\n');
}
function plotQq(result){
  const sorted=result.variants.map(v=>v.p).sort((a,b)=>a-b);const width=540,height=450,l=60,t=32,w=430,h=360;
  const maxY=Math.max(3,Math.min(80,Math.ceil(-Math.log10(Math.max(sorted[0],1e-300))+1)));
  const indices=new Set(Array.from({length:Math.min(500,sorted.length)},(_,i)=>Math.floor(i*(sorted.length-1)/Math.min(499,Math.max(1,sorted.length-1)))));
  for(let i=0;i<Math.min(sorted.length,80);i++)indices.add(i);
  const dots=[...indices].sort((a,b)=>a-b).map(i=>{const expected=-Math.log10((i+.5)/sorted.length),observed=-Math.log10(Math.max(sorted[i],1e-300));return `<circle cx="${(l+w*Math.min(1,expected/maxY)).toFixed(2)}" cy="${(t+h*(1-Math.min(1,observed/maxY))).toFixed(2)}" r="1.7" fill="#327caa"/>`;});
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Rice GWAS QQ plot"><rect width="${width}" height="${height}" fill="white"/><text x="60" y="20" font-size="15" fill="#162641">Rice GWAS: observed vs expected P</text><path d="M${l} ${t} V${t+h} H${l+w}" stroke="#445" fill="none"/><path d="M${l} ${t+h} L${l+w} ${t}" stroke="#d05a62" stroke-dasharray="6 4"/>${dots.join('')}<text x="240" y="${height-13}" font-size="12" fill="#445">Expected -log10 P</text><text x="6" y="23" font-size="12" fill="#445">Observed</text></svg>`;
}
const makeCrcTable=()=>Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const CRC_TABLE=makeCrcTable();
function crc32(buf){let c=0xffffffff;for(const b of buf)c=CRC_TABLE[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function createZip(files) {
  const locals=[],centers=[];let offset=0;
  for(const [name,source] of Object.entries(files)){
    check(/^[\w.-]{1,90}$/.test(name), 'Unsafe archive entry name');
    const data=Buffer.isBuffer(source)?source:Buffer.from(source,'utf8');const compressed=deflateRawSync(data,{level:6});
    const label=Buffer.from(name,'utf8');const crc=crc32(data);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(label.length,26);
    locals.push(h,label,compressed);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(label.length,28);c.writeUInt32LE(offset,42);centers.push(c,label);
    offset+=h.length+label.length+compressed.length;
  }
  const center=Buffer.concat(centers),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(center.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,center,end]);
}

export async function computeRiceGwas({ sourceFiles, outDirectory, fixture = false, onProgress=emitProgress }) {
  const source={};for(const name of FILE_ORDER){const file=sourceFiles[name];check(file?.buffer,`Missing required original dataset ${name}`);source[name]=file;}
  const map=parseMap(source['sativas413.map'].buffer.toString('utf8'));
  const phenotypes=parsePhenotypes(source['sativas413.pheno'].buffer.toString('utf8'));
  const pcs=parsePopulation(source['sativas413.csv'].buffer.toString('utf8'));
  onProgress('parsing_genotypes',{markers:map.length});
  const {samples,sampleVectors,invalid,totalPed}=parsePed(source['sativas413.ped'].buffer.toString('utf8'),map,phenotypes,pcs);
  if(!fixture)check(map.length===36901 && totalPed===413,`The pinned rice dataset does not have its expected 413 accessions and 36,901 SNPs (got ${totalPed}, ${map.length})`);
  const phenotext=`sample_id\tphenotype\tPC1\tPC2\tPC3\n${samples.map(s=>`RICE_${s.id}\t${s.trait}\t${s.covariates.join('\t')}`).join('\n')}\n`;
  const allVariants=[];const exclusions={multiallelic:0,invalid_genotype:0,missingness:0,rare_allele:0,insufficient_samples:0,rank_or_convergence:0};
  let validCount=0,chunks=0;
  const header=`CHR\tPOS\tSNP\t${samples.map(s=>`RICE_${s.id}`).join('\t')}\n`;
  const chunkLimit=3000;let rows=[];
  async function calculateChunk(){
    if(!rows.length)return;
    chunks++;
    try{
      const r=calculateGwas(header+rows.join('\n')+'\n',phenotext,{traitKind:'quantitative',minMaf:.05,maxMissing:.1,noCovariateAcknowledged:false});
      allVariants.push(...r.variants);
      for(const [key,count] of Object.entries(r.excluded))exclusions[key]=(exclusions[key]||0)+count;
    } catch(error){
      if(!String(error?.message||'').startsWith('No variants passed GWAS QC'))throw error;
      exclusions.rank_or_convergence+=rows.length;
    }
    rows=[];
  }
  for(let m=0;m<map.length;m++){
    if(invalid[m]){exclusions.multiallelic++;continue;}
    const mark=map[m];let raw=`${mark.chr}\t${mark.pos}\t${mark.id}`;
    for(const sample of sampleVectors){const allele=sample[m];raw+='\t'+(allele===255?'NA':allele);}
    rows.push(raw);validCount++;
    if(rows.length>=chunkLimit){await calculateChunk();if(chunks%2===0)onProgress('testing_associations',{processed:validCount,total:map.length});}
  }
  await calculateChunk();check(allVariants.length>0,'No rice markers passed association testing');
  // Recompute correction across *all* tested markers, never per-file chunk.
  const m=allVariants.length,sorted=allVariants.slice().sort((a,b)=>a.p-b.p);let minQ=1;
  for(let i=m-1;i>=0;i--){const v=sorted[i];v.bonferroni=Math.min(1,v.p*m);minQ=Math.min(minQ,v.p*m/(i+1));v.fdr=minQ;}
  allVariants.sort(gwasManhattanOrder);
  const result={schema:'genithm-public-rice-gwas/1',engineVersion:ENGINE,mode:'dosage-matrix',traitKind:'quantitative',associationMethod:'Covariate-adjusted additive OLS (two-sided Student t)',samplesInGenotypes:totalPed,samplesMatched:samples.length,covariates:['PC1','PC2','PC3'],variantsSeen:map.length,variantsTested:allVariants.length,excluded:exclusions,thresholds:{minMaf:.05,maxMissing:.1},significantBonferroni:allVariants.filter(v=>v.bonferroni<.05).length,warnings:['Exploratory GLM with three published ancestry PCs; no kinship random effect. Treat population structure and relatedness as important remaining confounders.','This is a real source-based GWAS, not a new published association discovery. Independently confirm significant loci, relatedness, allele coding and genome assembly.', 'All analyzed markers came from an authentic published rice 44K panel; no genotype, phenotype or P-value is AI-generated.'],variants:allVariants};
  const top=sorted.slice(0,15).map(v=>({chr:v.chrom,pos:v.pos,id:v.id,p:v.p,fdr:v.fdr,beta:v.beta,n:v.n}));
  const provenance={schema:'genithm-public-rice-gwas-provenance/1',engine:ENGINE,date_utc:new Date().toISOString(),organism:'Oryza sativa',dataset:'Rice Diversity Panel (Zhao et al. 2011)',paper_doi:'10.1038/ncomms1467',trait:'Plant height',samples_in_genotypes:totalPed,samples_complete:samples.length,snp_markers_in_source:map.length,snp_markers_tested:allVariants.length,exclusions,model:'Per-variant additive OLS adjusted for published PC1, PC2, PC3; two-sided t test',qc:{maf_at_least:.05,missingness_at_most:.1,minor_allele_count_at_least:5},multiple_testing:['Bonferroni','Benjamini-Hochberg FDR across all tested variants'],limitations:['Exploratory GLM not a kinship-adjusted linear mixed model','Full published marker map is processed; missing genotypes excluded per variant','No allelic effect prediction, causal claim or clinical interpretation'],source_repository:`https://github.com/${DATA_REPOSITORY}`,source_commit:DATA_REVISION,sources:Object.fromEntries(FILE_ORDER.map(name=>[name,{url:source[name].url,bytes:source[name].bytes,sha256:source[name].sha256,git_blob_sha1:source[name].git_blob_sha1}])),top_markers:top};
  const first=sorted[0],topline=`${first.chrom}:${first.pos} (${first.id}), P=${first.p.toExponential(3)}, BH q=${first.fdr.toExponential(3)}`;
  const report=`# Genithm public rice GWAS — measured Plant height\n\n**Actual published input data:** Zhao et al. (2011), DOI 10.1038/ncomms1467. Source accession panel: ${totalPed} Oryza sativa accessions, ${map.length} mapped SNPs. Genotype and phenotype source files were fetched verbatim from the pinned public repository commit ${DATA_REVISION}.\n\n**Analysis performed:** ${samples.length} rice accessions with complete recorded plant height and three supplied population-structure covariates (PC1/PC2/PC3). ${m} SNPs passed the defined QC and statistical checks. Full additive OLS + PC1/2/3; per-variant missing genotype deletion; MAF>=0.05; missingness <=0.10; Bonferroni and BH q-values across all ${m} tests. Genotypes were not synthesized or guessed.\n\n**Top association (exploratory):** ${topline}. Bonferroni P<0.05: ${result.significantBonferroni}.\n\n**Outputs:** association.tsv (ALL tested markers), manhattan.svg, qq.svg, provenance.json and summary.json. Every source SHA256 and publication path is in provenance.json.\n\n**Scientific limitations:** Association is not causation. The population PC adjustment does not replace a kinship-aware mixed-model analysis; relatedness, LD, potential batch effects, cultivar structure and multiple phenotypic years require additional checks. Use PLINK2, GEMMA, REGENIE or a suitable rice GWAS tool for peer-reviewed claims. This is not clinical or plant breeding advice.\n`;
  const bytes={
    'association.tsv':gwasSummaryTsv(result,source['sativas413.ped'].sha256,source['sativas413.pheno'].sha256).replace(/^# genotype_sha256=.*?\n/m,`# genotype_source_sha256=${source['sativas413.ped'].sha256}; phenotype_source_sha256=${source['sativas413.pheno'].sha256}; population_source_sha256=${source['sativas413.csv'].sha256}\n`),
    'manhattan.svg':plotManhattan(result),'qq.svg':plotQq(result),
    'provenance.json':JSON.stringify(provenance,null,2)+'\n','summary.json':JSON.stringify({dataset:provenance.dataset,trait:'Plant height',accessions:totalPed,matched:samples.length,markers_source:map.length,markers_tested:allVariants.length,significant_bonferroni:result.significantBonferroni,top_markers:top,excluded:exclusions,engine:ENGINE},null,2)+'\n',
    'README.md':report,
  };
  await mkdir(outDirectory,{recursive:true,mode:0o700});
  for(const [name,content] of Object.entries(bytes))await writeFile(join(outDirectory,name),content,{mode:0o600});
  await writeFile(join(outDirectory,'rice-gwas-results.zip'),createZip(bytes),{mode:0o600});
  onProgress('finished',{markers_tested:m,matched:samples.length,significant:result.significantBonferroni});
  return {provenance,outputs:Object.keys(bytes).concat('rice-gwas-results.zip')};
}

export async function runPublicRiceStudy({outDirectory, fixtureDirectory=null,onProgress=emitProgress}){
  const sources={};
  for(const name of FILE_ORDER){onProgress('downloading',{file:name});sources[name]=await downloadSource(name,fixtureDirectory);}
  return computeRiceGwas({sourceFiles:sources,outDirectory,fixture:Boolean(fixtureDirectory),onProgress});
}
function parseCli(args){const permitted=['--out','--fixture'];check(args.length%2===0,'Expected --out DIR [--fixture DIR]');
 const result={};for(let i=0;i<args.length;i+=2){check(permitted.includes(args[i]) && !result[args[i]],'Unsupported argument');result[args[i]]=args[i+1];}
 check(result['--out'] && resolve(result['--out'])!==resolve('/'),'Output directory required');return result;}
if(process.argv[1] && /public_rice_gwas\.mjs$/.test(process.argv[1])){
 try{const a=parseCli(process.argv.slice(2));await runPublicRiceStudy({outDirectory:resolve(a['--out']),fixtureDirectory:a['--fixture']?resolve(a['--fixture']):null});}
 catch(error){process.stderr.write(`[Genithm Rice GWAS] ${String(error?.message||error).slice(0,450)}\n`);process.exitCode=1;}
}
