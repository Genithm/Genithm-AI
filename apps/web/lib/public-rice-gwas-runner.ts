/**
 * A strictly Codespaces-only, authenticated public-dataset worker. All source
 * addresses, trait and methods are fixed by reviewed code, never user/LLM
 * supplied. Private project genomic data are never included in this run.
 */
import "server-only";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = join(tmpdir(), "genithm-v57-public-rice-gwas");
const OUTPUTS = ["rice-gwas-results.zip", "association.tsv", "manhattan.svg", "qq.svg", "provenance.json", "summary.json", "README.md"] as const;
export type RiceFile = typeof OUTPUTS[number];
const RUN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 48 * 3600 * 1000;
const EXECUTION_TIMEOUT_MS = 7 * 60 * 1000;
const EXPECTED_COMMIT = "d83cc64f993f8a86485d30f715381b3c613e3d69";
const EXPECTED_ENGINE = "genithm-public-rice-gwas/1.0.1";
const CACHE_DIR = join(BASE,"public-cache-"+createHash("sha256").update(EXPECTED_COMMIT+"|"+EXPECTED_ENGINE+"|Plant height|PC1,PC2,PC3|MAF=.05|MISS=.10").digest("hex").slice(0,24));
const ID_REGEX = /^[0-9a-f-]{36}$/i;

type Summary = {
  trait: string;
  accessions: number;
  matched: number;
  markers_source: number;
  markers_tested: number;
  significant_bonferroni: number;
  genomic_inflation_lambda: number;
  top_markers: Array<{ id: string; chr: string; pos: number; p: number; fdr: number }>;
};
type Metadata = { owner: string; created_at: number; source_commit: string; summary: Summary; hashes: Record<string, string> };

function ownerHash(userId: string): string {
  if (!ID_REGEX.test(userId)) throw new Error("Invalid authenticated user identity.");
  return createHash("sha256").update(userId).digest("hex");
}
function rootFor(userId: string, runId: string) {
  if (!RUN_REGEX.test(runId)) throw new Error("Invalid study identifier.");
  return join(BASE, ownerHash(userId), runId);
}
function publicStudyEnabled(): boolean {
  // Cloudflare production cannot provide persistent POSIX process isolation.
  return process.env.NODE_ENV === "development" &&
    process.env.GENITHM_CODESPACES_PREVIEW === "1" &&
    Boolean(process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN);
}

async function readMetadata(userId: string, runId: string): Promise<Metadata> {
  const directory = rootFor(userId, runId);
  const metadata = JSON.parse(await readFile(join(directory, "owner.json"), "utf8")) as Metadata;
  if (metadata.owner !== ownerHash(userId) || metadata.source_commit !== EXPECTED_COMMIT ||
      !Number.isFinite(metadata.created_at) || Date.now() - metadata.created_at > MAX_AGE_MS ||
      metadata.created_at > Date.now() + 60000) throw new Error("This research result has expired or is not accessible.");
  return metadata;
}
export async function authenticatedRiceResult(userId: string, runId: string, fileName: string): Promise<{ bytes: Buffer; contentType: string }> {
  if (!OUTPUTS.includes(fileName as RiceFile)) throw new Error("This result format is not available.");
  const metadata = await readMetadata(userId, runId);
  const bytes = await readFile(join(rootFor(userId, runId), fileName));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (metadata.hashes[fileName] !== hash) throw new Error("Result file failed its integrity check.");
  const contentType = fileName.endsWith(".zip") ? "application/zip" : fileName.endsWith(".svg") ? "image/svg+xml" : fileName.endsWith(".json") ? "application/json" : fileName.endsWith(".tsv") ? "text/tab-separated-values" : "text/markdown";
  return { bytes, contentType };
}

async function sweepExpired(): Promise<void> {
  const users = await readdir(BASE, { withFileTypes: true }).catch(() => []);
  for (const user of users) {
    if (!user.isDirectory() || !/^[a-f0-9]{64}$/.test(user.name)) continue;
    const runs = await readdir(join(BASE, user.name), { withFileTypes: true }).catch(() => []);
    for (const run of runs) {
      if (!run.isDirectory() || !RUN_REGEX.test(run.name)) continue;
      const dir=join(BASE,user.name,run.name);
      const age=await stat(dir).then(x=>Date.now()-x.mtimeMs).catch(()=>0);
      if(age > MAX_AGE_MS * 2) await rm(dir,{recursive:true,force:true}).catch(()=>{});
    }
  }
}

/** A public-source cache must validate every file before reuse and must never
 * include user-scoped metadata or private research inputs.
 */
async function restorePublicCache(destination: string): Promise<boolean> {
  try {
    const cache = JSON.parse(await readFile(join(CACHE_DIR,"cache.json"),"utf8")) as {
      source_commit?: string; engine?: string; hashes?: Record<string,string>;
    };
    if(cache.source_commit!==EXPECTED_COMMIT || cache.engine!==EXPECTED_ENGINE)return false;
    const contents=await Promise.all(OUTPUTS.map(file=>readFile(join(CACHE_DIR,file))));
    for(let i=0;i<OUTPUTS.length;i++){
      if(createHash("sha256").update(contents[i]).digest("hex")!==cache.hashes?.[OUTPUTS[i]])return false;
    }
    for(const file of OUTPUTS)await copyFile(join(CACHE_DIR,file),join(destination,file));
    return true;
  }catch {return false;}
}
async function savePublicCache(directory: string, hashes: Record<string,string>): Promise<void> {
  const staging=join(BASE,"cache-staging-"+randomUUID());
  try{
    await mkdir(staging,{mode:0o700});
    for(const file of OUTPUTS)await copyFile(join(directory,file),join(staging,file));
    await writeFile(join(staging,"cache.json"),JSON.stringify({
      source_commit:EXPECTED_COMMIT,engine:EXPECTED_ENGINE,hashes
    }),{mode:0o600});
    await rm(CACHE_DIR,{recursive:true,force:true});
    await rename(staging,CACHE_DIR);
  }finally {await rm(staging,{recursive:true,force:true}).catch(()=>{});}
}
/** One at a time across a Codespace checkout; no public data access without auth. */
export async function executePublicRiceGwas(userId: string, signal: AbortSignal, progress: (message: string) => void) {
  if (!publicStudyEnabled()) throw new Error("Automated rice GWAS currently requires a private, running Genithm Codespace; this deployment has no safe public-data compute worker.");
  const hash=ownerHash(userId);
  await mkdir(BASE,{recursive:true,mode:0o700});
  await sweepExpired();
  const lock=join(BASE,"worker-lock");
  try { await mkdir(lock,{mode:0o700}); }
  catch { throw new Error("A public rice study is already running in this Codespace. Do not start another simultaneous copy."); }
  const runId=randomUUID();
  const directory=rootFor(userId,runId);
  let succeeded=false;
  try {
    await mkdir(directory,{recursive:true,mode:0o700});
    if(signal.aborted)throw new Error("Rice GWAS cancelled before starting.");
    const cacheHit=await restorePublicCache(directory);
    if(cacheHit)progress("Reusing checksum-verified public rice GWAS results from the same pinned source and analysis version…");
    if(!cacheHit){
    const repoRoot=resolve(process.cwd(),"../..");
    const script=join(repoRoot,"scripts","public_rice_gwas.mjs");
    // The subprocess does not inherit API keys or Supabase credentials.
    const child=spawn(process.execPath,["--experimental-strip-types",script,"--out",directory],{
      cwd:repoRoot,env:{PATH:process.env.PATH||"/usr/bin:/bin",HOME:process.env.HOME||"/tmp",NODE_ENV:"development"},
      stdio:["ignore","pipe","pipe"],windowsHide:true,
    });
    let stdoutBuffer="",stderrBuffer="",done=false;
    const reason=await new Promise<string|null>((resolveExit)=>{
      const timer=setTimeout(()=>{child.kill("SIGKILL");resolveExit("Rice GWAS hit its bounded execution deadline.");},EXECUTION_TIMEOUT_MS);
      const cancel=()=>{child.kill("SIGKILL");resolveExit("Rice GWAS cancelled by researcher.");};
      if(signal.aborted) cancel();
      else signal.addEventListener("abort",cancel,{once:true});
      child.stdout.on("data",(buf:Buffer)=>{
        stdoutBuffer+=buf.toString("utf8");
        if(stdoutBuffer.length>8192) stdoutBuffer=stdoutBuffer.slice(-4096);
        let pos=stdoutBuffer.indexOf("\n");
        while(pos>=0){const line=stdoutBuffer.slice(0,pos);stdoutBuffer=stdoutBuffer.slice(pos+1);pos=stdoutBuffer.indexOf("\n");
          try {const event=JSON.parse(line) as {stage?:string;file?:string;processed?:number;total?:number};
            if(event.stage==="downloading" && ["sativas413.ped","sativas413.map","sativas413.pheno","sativas413.csv"].includes(event.file||"")) progress(`Fetching verified published rice data: ${event.file}…`);
            else if(event.stage==="parsing_genotypes") progress("Matching real rice genotypes, phenotypes and published ancestry PCs…");
            else if(event.stage==="testing_associations") progress(`Testing genetic associations: ${Number(event.processed)||0} of ${Number(event.total)||0} SNPs processed…`);
            else if(event.stage==="finished") progress("GWAS completed. Verifying downloadable scientific results…");
          } catch { /* No untrusted child output is rendered. */ }
        }
      });
      child.stderr.on("data",(buf:Buffer)=>{stderrBuffer=(stderrBuffer+buf.toString("utf8")).slice(-1024);});
      child.once("error",()=>{if(!done){done=true;clearTimeout(timer);signal.removeEventListener("abort",cancel);resolveExit("The scientific analysis worker could not be started.");}});
      child.once("close",code=>{if(!done){done=true;clearTimeout(timer);signal.removeEventListener("abort",cancel);
        // Never surface raw stdout/stderr from a child process or source server.
        resolveExit(code===0?null:"The published rice study failed validation or computation; no result files were certified.");}});
    });
    if(reason) throw new Error(reason);
    }
    if(signal.aborted)throw new Error("Rice GWAS cancelled before its results could be certified.");
    const source=JSON.parse(await readFile(join(directory,"provenance.json"),"utf8")) as {source_commit?:string,trait?:string,engine?:string};
    const summary=JSON.parse(await readFile(join(directory,"summary.json"),"utf8")) as Summary;
    if(source.source_commit!==EXPECTED_COMMIT || summary.trait!=="Plant height" || summary.markers_tested<5000 || summary.matched<100 || summary.markers_source!==36901 ||
       source.engine!==EXPECTED_ENGINE || !Number.isFinite(summary.genomic_inflation_lambda) ||
       summary.genomic_inflation_lambda<0) {
      throw new Error("Rice GWAS result did not match expected published-data invariants.");
    }
    const hashes:Record<string,string>={};
    for(const file of OUTPUTS){const bytes=await readFile(join(directory,file));
      if(bytes.length<50 || bytes.length>25_000_000) throw new Error("Unexpected GWAS artifact size.");
      hashes[file]=createHash("sha256").update(bytes).digest("hex");
    }
    if(!cacheHit)await savePublicCache(directory,hashes).catch(()=>{/* Optional cache; failure must not invalidate verified science. */});
    await writeFile(join(directory,"owner.json"),JSON.stringify({owner:hash,created_at:Date.now(),source_commit:EXPECTED_COMMIT,summary,hashes} satisfies Metadata),{mode:0o600});
    succeeded=true;
    return {runId,summary};
  } finally {
    if(!succeeded) await rm(directory,{force:true,recursive:true}).catch(()=>{});
    await rm(lock,{force:true,recursive:true}).catch(()=>{});
  }
}
