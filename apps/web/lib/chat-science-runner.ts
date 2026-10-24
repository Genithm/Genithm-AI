/** Genithm V58: authenticated, bounded, reusable chat science execution.
 * All operations are compiled deterministic scientific code, not LLM text.
 * Private uploads are held only during execution in owner-scoped Codespaces
 * directories and never cached. Public source results may be reused only
 * after validating every file digest and the immutable analysis method.
 */
import 'server-only';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const CHAT_SCIENCE_VERSION = 'genithm-chat-science/1.5.0';
export const CHAT_SCIENCE_BASE = join(tmpdir(),'genithm-v58-chat-science');
export const CHAT_SCIENCE_AGE_MS = 48*3600*1000;
const EXECUTION_LIMIT_MS = 150_000;
const ACCEPTED_MANIFEST_VERSIONS = new Set(['genithm-chat-science/1.0.0','genithm-chat-science/1.1.0','genithm-chat-science/1.2.0','genithm-chat-science/1.3.0','genithm-chat-science/1.4.0',CHAT_SCIENCE_VERSION]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/i;
const ALLOWED_KINDS = ['gwas','expression','pathways','public-airway','fastq-qc','vcf-qc','fasta-qc','fastq-trim','orf-scan','genomic-overlap','sam-qc','bam-qc'] as const;
export type ChatScienceKind = typeof ALLOWED_KINDS[number];
const REQUIRED_FILES: Record<Exclude<ChatScienceKind,'public-airway'>,Record<string,number>> = {
  gwas: {genotypes:64*1024*1024,phenotypes:2*1024*1024},
  expression: {counts:32*1024*1024,design:512*1024},
  pathways: {selected:1024*1024,universe:1024*1024,gmt:8*1024*1024},
  'fastq-qc': {r1:12*1024*1024,r2:12*1024*1024},
  'vcf-qc': {vcf:8*1024*1024},
  'fasta-qc': {fasta:32*1024*1024},
  'fastq-trim': {r1:12*1024*1024,r2:12*1024*1024},
  'orf-scan': {fasta:32*1024*1024},
  'genomic-overlap': {bed:8*1024*1024,gff3:8*1024*1024},
  'sam-qc': {sam:12*1024*1024},
  'bam-qc': {bam:12*1024*1024},
};
const FILE_NAMES = new Set(['complete-results.zip','association.tsv','manhattan.svg','qq.svg','expression.tsv',
  'significant_genes.txt','measured_genes.txt','sample_qc.tsv','volcano.svg','sample-pca.svg',
  'pathway-enrichment.tsv','enrichment.svg','fastq-qc.tsv','quality-by-cycle.svg','read-lengths.svg',
  'vcf-qc.tsv','variant-types.svg','fasta-stats.tsv','sequence-lengths.svg',
  'trimmed_R1.fastq.gz','trimmed_R2.fastq.gz','trimming-summary.tsv','post-trim-qc.tsv','read-retention.svg',
  'orfs.tsv','orfs.gff3','proteins.faa','orf-lengths.svg',
  'interval-overlaps.tsv','coverage-by-feature.tsv','genomic-overlaps.svg',
  'sam-mapping-qc.tsv','sam-reference-coverage.tsv','sam-cigar-operations.tsv','sam-mapq.svg',
  'bam-mapping-qc.tsv','bam-reference-coverage.tsv','bam-cigar-operations.tsv','bam-mapq.svg',
  'summary.json','provenance.json','METHODS.md']);
const CACHE_ID = createHash('sha256').update('Himes2014|bioconnector/workshops@68ff3e4868b0e5673a1c4399828a3e0adc72f8e4|'+CHAT_SCIENCE_VERSION+'|control-treated-minCPM1').digest('hex').slice(0,25);
const PUBLIC_CACHE = join(CHAT_SCIENCE_BASE,'public-airway-cache-'+CACHE_ID);

type ScientificSummary = {kind:ChatScienceKind;method:string;inputs:string;warnings:string[];[key:string]:unknown};
type Manifest = {kind:ChatScienceKind;version:string;filenames:string[];hashes:Record<string,string>;summary:ScientificSummary};
type Metadata = Manifest & {owner_hash:string;project_id:string;created_at:number};
const sha = (b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
function userDigest(id:string){if(!UUID.test(id))throw new Error('Authenticated user reference invalid.');return sha(id);}
function ownerDirectory(userId:string,runId:string){if(!RESULT_UUID.test(runId))throw new Error('Invalid scientific run reference.');return join(CHAT_SCIENCE_BASE,userDigest(userId),runId);}
export function chatScienceAvailable(){return process.env.NODE_ENV==='development'&&process.env.GENITHM_CODESPACES_PREVIEW==='1'&&
  !!process.env.CODESPACE_NAME&&!!process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;}
export function chatScienceRequiredFiles(kind:ChatScienceKind){return kind==='public-airway'?{}:REQUIRED_FILES[kind];}
/** A single FASTQ R1 is legal; paired FASTQ requires BOTH correctly ordered
 * mates. No other scientific task permits silent optional missing inputs. */
export function chatScienceAcceptsRoles(kind:ChatScienceKind,keys:string[]){
  if(!ALLOWED_KINDS.includes(kind)||new Set(keys).size!==keys.length)return false;
  const got=keys.slice().sort().join(',');
  if(kind==='fastq-qc'||kind==='fastq-trim')return got==='r1'||got==='r1,r2';
  return got===Object.keys(chatScienceRequiredFiles(kind)).sort().join(',');
}
function validateManifest(manifest:Manifest){
  if(!ALLOWED_KINDS.includes(manifest.kind)||!ACCEPTED_MANIFEST_VERSIONS.has(manifest.version)||
     !Array.isArray(manifest.filenames)||manifest.filenames.length<3||manifest.filenames.length>15||
     new Set(manifest.filenames).size!==manifest.filenames.length||
     !manifest.filenames.every(x=>FILE_NAMES.has(x)&&SHA.test(manifest.hashes?.[x]||''))||
     !manifest.filenames.includes('complete-results.zip')||!manifest.filenames.includes('summary.json')||
     manifest.summary?.kind!==manifest.kind||!Array.isArray(manifest.summary.warnings))
    throw new Error('Scientific result manifest is invalid.');
}
export async function getChatScienceRun(userId:string,projectId:string,runId:string):Promise<Metadata>{
  if(!UUID.test(projectId))throw new Error('Invalid research project.');
  const directory=ownerDirectory(userId,runId);
  const meta=JSON.parse(await readFile(join(directory,'owner.json'),'utf8')) as Metadata;
  if(meta.owner_hash!==userDigest(userId)||meta.project_id!==projectId||
     !Number.isFinite(meta.created_at)||meta.created_at>Date.now()+60000||Date.now()-meta.created_at>CHAT_SCIENCE_AGE_MS)
    throw new Error('This scientific result is expired or belongs to a different user or project.');
  validateManifest(meta);
  return meta;
}
export async function getChatScienceArtifact(userId:string,runId:string,file:string):Promise<{data:Buffer;type:string;projectId:string}>{
  if(!RESULT_UUID.test(runId)||!FILE_NAMES.has(file))throw new Error('Unknown scientific result reference.');
  const dir=ownerDirectory(userId,runId);
  const meta=JSON.parse(await readFile(join(dir,'owner.json'),'utf8')) as Metadata;
  if(meta.owner_hash!==userDigest(userId)||Date.now()-meta.created_at>CHAT_SCIENCE_AGE_MS||
     meta.created_at>Date.now()+60000||!meta.filenames.includes(file))throw new Error('Unavailable or expired research result.');
  validateManifest(meta);
  const data=await readFile(join(dir,file));
  if(sha(data)!==meta.hashes[file])throw new Error('Scientific result checksum failed.');
  const type=file.endsWith('.zip')?'application/zip':file.endsWith('.fastq.gz')?'application/gzip':file.endsWith('.svg')?'image/svg+xml':
    file.endsWith('.json')?'application/json':file.endsWith('.tsv')?'text/tab-separated-values':'text/plain';
  return {data,type,projectId:meta.project_id};
}
async function cleanExpired(){
  const dirs=await readdir(CHAT_SCIENCE_BASE,{withFileTypes:true}).catch(()=>[]);
  for(const user of dirs){if(!user.isDirectory()||!SHA.test(user.name))continue;
    for(const run of await readdir(join(CHAT_SCIENCE_BASE,user.name),{withFileTypes:true}).catch(()=>[])){
      if(!run.isDirectory()||!RESULT_UUID.test(run.name))continue;
      const path=join(CHAT_SCIENCE_BASE,user.name,run.name);
      const age=await stat(path).then(x=>Date.now()-x.mtimeMs).catch(()=>0);
      if(age>CHAT_SCIENCE_AGE_MS*2)await rm(path,{recursive:true,force:true}).catch(()=>{});
    }
  }
}
async function verifiedPublicCopy(destination:string):Promise<boolean>{
  try{
    const m=JSON.parse(await readFile(join(PUBLIC_CACHE,'result-manifest.json'),'utf8')) as Manifest;
    validateManifest(m);
    if(m.kind!=='public-airway')return false;
    const sources=JSON.parse(await readFile(join(PUBLIC_CACHE,'provenance.json'),'utf8')) as {public_source?:{revision?:string}};
    if(sources.public_source?.revision!=='68ff3e4868b0e5673a1c4399828a3e0adc72f8e4')return false;
    const all=await Promise.all(m.filenames.map(n=>readFile(join(PUBLIC_CACHE,n))));
    if(all.some((x,i)=>sha(x)!==m.hashes[m.filenames[i]]))return false;
    for(const name of m.filenames)await copyFile(join(PUBLIC_CACHE,name),join(destination,name));
    await copyFile(join(PUBLIC_CACHE,'result-manifest.json'),join(destination,'result-manifest.json'));
    return true;
  }catch{return false;}
}
async function saveVerifiedPublicCache(dir:string){
  const staging=join(CHAT_SCIENCE_BASE,'cache-stage-'+randomUUID());
  try{
    await mkdir(staging,{mode:0o700});
    const m=JSON.parse(await readFile(join(dir,'result-manifest.json'),'utf8')) as Manifest;
    validateManifest(m);if(m.kind!=='public-airway')return;
    for(const name of [...m.filenames,'result-manifest.json'])await copyFile(join(dir,name),join(staging,name));
    await rm(PUBLIC_CACHE,{recursive:true,force:true});await rename(staging,PUBLIC_CACHE);
  }finally{await rm(staging,{recursive:true,force:true}).catch(()=>{});}
}
export async function runChatScience(userId:string,projectId:string,kind:ChatScienceKind,
  sources:Record<string,File>,signal:AbortSignal,progress:(text:string)=>void):Promise<{runId:string;summary:ScientificSummary;files:string[]}>{
  if(!chatScienceAvailable())throw new Error('Scientific execution requires a running private Codespace with a Node scientific worker.');
  if(!UUID.test(projectId))throw new Error('Invalid research project identifier.');
  const hash=userDigest(userId);
  if(!ALLOWED_KINDS.includes(kind))throw new Error('Unsupported scientific analysis.');
  const needed=chatScienceRequiredFiles(kind);
  if(!chatScienceAcceptsRoles(kind,Object.keys(sources)))throw new Error('Expected input file roles do not match this scientific task.');
  for(const [name,limit] of Object.entries(needed)){
    if((kind==='fastq-qc'||kind==='fastq-trim') && name==='r2' && !sources.r2)continue;
    const file=sources[name];
    if(!(file instanceof File)||file.size<1||file.size>limit)throw new Error(`The ${name} file is missing or exceeds the supported ${Math.ceil(limit/1024/1024)} MiB ceiling.`);
  }
  if(signal.aborted)throw new Error('Scientific request cancelled.');
  await mkdir(CHAT_SCIENCE_BASE,{recursive:true,mode:0o700});await cleanExpired();
  const lock=join(CHAT_SCIENCE_BASE,'execution-lock');
  try{await mkdir(lock,{mode:0o700});}catch{
    // A killed Codespaces process can leave a lock. Only a lock older than
    // the maximum possible worker deadline is considered stale.
    const age=await stat(lock).then(x=>Date.now()-x.mtimeMs).catch(()=>0);
    if(age>EXECUTION_LIMIT_MS+60000){await rm(lock,{recursive:true,force:true});
      try{await mkdir(lock,{mode:0o700});}catch{throw new Error('Another scientific job is running in this Codespace.');}
    }else throw new Error('Another scientific job is running in this Codespace. Try your request after it completes.');
  }
  const runId=randomUUID(), dir=ownerDirectory(userId,runId), inputDir=join(dir,'private-inputs');
  let complete=false;
  try{
    await mkdir(inputDir,{recursive:true,mode:0o700});
    for(const [role,file] of Object.entries(sources)){
      const raw=Buffer.from(await file.arrayBuffer());
      if(raw.length!==file.size)throw new Error('Input bytes changed during upload.');
      await writeFile(join(inputDir,role+'.txt'),raw,{mode:0o600});
    }
    progress(kind==='public-airway'?'Finding pinned, verified human airway RNA-seq counts and treatment groups…':
      kind==='fastq-trim'?'Validating, adapter clipping and trimming all FASTQ reads…':
      kind==='orf-scan'?'Finding six-frame candidate open reading frames and translating proteins…':
       kind==='genomic-overlap'?'Indexing BED and GFF3 intervals, computing overlap and union coverage…':
       kind==='sam-qc'?'Validating SAM records, CIGAR mapping quality and measured reference coverage…':
       kind==='bam-qc'?'Decoding BGZF BAM records and calculating real mapping statistics and reference coverage…':
      'Checking file integrity and running validated scientific tests…');
    const cacheHit=kind==='public-airway'&&await verifiedPublicCopy(dir);
    if(cacheHit)progress('Reusing the checksum-verified version of the same published public RNA study…');
    if(!cacheHit){
      const repoRoot=resolve(process.cwd(),'../..');
      const script=join(repoRoot,'scripts','chat_science_worker.mjs');
      const args=['--experimental-strip-types',script,'--kind',kind,'--inputs',inputDir,'--out',dir];
      const child=spawn(process.execPath,args,{cwd:repoRoot,env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'development'},stdio:['ignore','pipe','pipe'],windowsHide:true});
      let buffer='',finished=false;
      const failure=await new Promise<string|null>(done=>{
        const settle=(message:string|null)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);done(message);};
        const timer=setTimeout(()=>{child.kill('SIGKILL');settle('Scientific execution exceeded its 150-second limit.');},EXECUTION_LIMIT_MS);
        const cancel=()=>{child.kill('SIGKILL');settle('Scientific analysis was cancelled.');};
        if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
        child.stdout.on('data',(chunk:Buffer)=>{
          buffer=(buffer+chunk.toString('utf8')).slice(-8192);
          let end=buffer.indexOf('\n');while(end>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);end=buffer.indexOf('\n');
            try{const event=JSON.parse(line) as {stage?:string;count?:number};
              if(event.stage==='fetching_public_data')progress('Downloading authentic source-verified RNA-seq data…');
              else if(event.stage==='testing_genes'&&Number(event.count)%5000===0)progress(`Calculating expression statistics for ${event.count} genes…`);
              else if(event.stage==='testing_variants'&&Number(event.count)%1000===0)progress(`Testing ${event.count} genetic variants…`);
              else if(event.stage==='testing_sets'&&Number(event.count)%300===0)progress(`Testing ${event.count} gene sets…`);
              else if(event.stage==='finished')progress('Verifying completed analysis and preparing downloadable files…');
            }catch{/* Only reviewed worker event types may affect UI. */}
          }
        });
        child.stderr.on('data',()=>{/* Do not expose sensitive user filenames or upstream contents. */});
        child.once('error',()=>settle('Could not start the scientific worker.'));
        child.once('close',code=>settle(code===0?null:'Scientific data failed validation or the computation could not be completed. No successful results were recorded.'));
      });
      if(failure)throw new Error(failure);
    }
    if(signal.aborted)throw new Error('Scientific analysis cancelled before verification.');
    const manifest=JSON.parse(await readFile(join(dir,'result-manifest.json'),'utf8')) as Manifest;
    validateManifest(manifest);if(manifest.kind!==kind)throw new Error('Scientific analysis result does not match the requested task.');
    for(const name of manifest.filenames){const data=await readFile(join(dir,name));if(sha(data)!==manifest.hashes[name]||data.length>30_000_000)throw new Error('Scientific result checksum or size mismatch.');}
    if(kind==='public-airway'&&!cacheHit)await saveVerifiedPublicCache(dir).catch(()=>{/* Cache is best effort. */});
    const metadata:Metadata={...manifest,owner_hash:hash,project_id:projectId,created_at:Date.now()};
    await writeFile(join(dir,'owner.json'),JSON.stringify(metadata),{mode:0o600});
    complete=true;
    return {runId,summary:manifest.summary,files:manifest.filenames};
  }finally{
    await rm(inputDir,{recursive:true,force:true}).catch(()=>{});
    if(!complete)await rm(dir,{recursive:true,force:true}).catch(()=>{});
    await rm(lock,{recursive:true,force:true}).catch(()=>{});
  }
}
