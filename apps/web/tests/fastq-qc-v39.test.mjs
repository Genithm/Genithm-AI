import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeFastqQc,parseFastq,validateFastqQcSummary,fastqQcTsv,
  FASTQ_QC_VERSION,MAX_FASTQ_BYTES,MAX_FASTQ_READS,
} from "../lib/fastq-quality-control.ts";

const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const fq=(id,sequence,quality,mate=1)=>
  "@"+id+"/"+mate+"\n"+sequence+"\n+\n"+quality+"\n";
const r1=fq("sample1","ACGTN","IIIII")+fq("sample2","GCAA","5555");
const r2=fq("sample1","TTTTN","IIIII",2)+fq("sample2","ACGT","5555",2);
const hash="ab".repeat(32);

test("V39 real single-end FASTQ Q20/Q30, GC, read length and per-cycle profiles",()=>{
  const s=analyzeFastqQc(r1);
  assert.equal(s.analyzerVersion,FASTQ_QC_VERSION);
  assert.equal(s.mode,"single");
  assert.equal(s.reads.length,1);
  const q=s.reads[0];
  assert.equal(q.readCount,2);
  assert.equal(q.baseCount,9);
  assert.equal(q.minLength,4);assert.equal(q.maxLength,5);
  assert.equal(q.meanLength,4.5);
  assert.equal(q.meanPhred,31.111);
  assert.equal(q.gcPercent,50);
  assert.equal(q.nPercent,11.11);
  assert.equal(q.q20BaseCount,9);
  assert.equal(q.q30BaseCount,5);
  assert.deepEqual(q.baseCounts,{A:3,C:2,G:2,T:1,N:1});
  assert.deepEqual(q.qualityBands,[0,0,4,0,5]);
  assert.deepEqual(q.lengthBands,[2,0,0,0,0,0,0]);
  assert.deepEqual(q.perCycle,[
    [2,30,50],[2,30,50],[2,30,50],[2,30,50],[1,40,100],
  ]);
  assert.equal(validateFastqQcSummary(s),true);
});

test("V39 paired-end enforces equal read counts, mate identifiers and correct order",()=>{
  const s=analyzeFastqQc(r1,r2);
  assert.equal(s.mode,"paired");
  assert.equal(s.matesChecked,true);
  assert.equal(s.reads.length,2);
  assert.equal(s.reads[0].readCount,2);
  assert.equal(s.reads[1].readCount,2);
  assert.equal(s.reads[1].q30BaseCount,5);
  assert.ok(validateFastqQcSummary(s));
  assert.throws(()=>analyzeFastqQc(r1,fq("sample1","ACGT","IIII",2)),/read counts/);
  const swapped=fq("sample2","ACGT","5555",2)+fq("sample1","TTTTN","IIIII",2);
  assert.throws(()=>analyzeFastqQc(r1,swapped),/mate order/);
  assert.throws(()=>analyzeFastqQc(r1,r1),/mate order/);
});

test("V39 rejects malformed and ambiguous FASTQ; never guesses Phred encoding",()=>{
  const bad=[
    "", "FASTA\nACGT",
    "@read\nACGT\n+\n!!!\n",
    "@read\nACGT\n+\n",
    "@read\nACGT\n+wrong\nIIII\n",
    "@read\nACXT\n+\nIIII\n",
    "@read\nACGT\n+\n    \n",
    "@read\nACGT\n+\nI\tII\n",
    fq("read","A".repeat(401),"I".repeat(401)),
    "@read\nACGT\n+\nIIII\n@unclosed",
    "@read\nACGT\n+\nIIII\n\u0000",
  ];
  for(const source of bad)assert.throws(()=>parseFastq(source),{name:"FastqQcError"});
  assert.throws(()=>parseFastq("A".repeat(MAX_FASTQ_BYTES+1)),/12 MiB/);
  assert.equal(MAX_FASTQ_READS,100000);
});

test("V39 summary guard rejects modified counts and hidden raw-read fields",()=>{
  const s=analyzeFastqQc(r1,r2);
  const variants=[
    {...s,reads:[...s.reads,{...s.reads[1]}]},
    {...s,mode:"single"},
    {...s,readName:"PRIVATE_SEQUENCE_HEADER"},
    {...s,reads:[{...s.reads[0],qualities:"IIII"},s.reads[1]]},
    {...s,reads:[{...s.reads[0],baseCounts:{...s.reads[0].baseCounts,A:42}},s.reads[1]]},
    {...s,reads:[{...s.reads[0],qualityBands:[0,0,0,0,9]},s.reads[1]]},
    {...s,reads:[{...s.reads[0],perCycle:[[1,40,100]]},s.reads[1]]},
    {...s,reads:[{...s.reads[0],meanPhred:42},s.reads[1]]},
  ];
  for(const variant of variants)assert.equal(validateFastqQcSummary(variant),false);
});

test("V39 TSV exports exact data and honest client-hash provenance",()=>{
  const single=fastqQcTsv(analyzeFastqQc(r1),[hash]);
  assert.match(single,/Read count\t2/);
  assert.match(single,/Q30 bases\t5/);
  assert.match(single,/client-computed SHA-256/i);
  assert.ok(single.includes(hash));
  assert.match(single,/Cycle\tReads reaching cycle\tMean Phred\tQ30 %/);
  assert.throws(()=>fastqQcTsv(analyzeFastqQc(r1),["invalid"]),/fingerprints/);
  const paired=fastqQcTsv(analyzeFastqQc(r1,r2),[hash,"cd".repeat(32)]);
  assert.match(paired,/Metric\tR1\tR2/);
  assert.match(paired,/Paired identifiers checked\tyes/);
});

test("V39 privacy and authorization: only user-scoped aggregate snapshots in Supabase",()=>{
  const sql=read("../../../supabase/migrations/20261016190000_fastq_qc_snapshots_v39.sql");
  const actions=read("../app/dashboard/fastq-qc/actions.ts");
  const page=read("../app/dashboard/fastq-qc/page.tsx");
  const saved=read("../app/dashboard/fastq-qc/[id]/page.tsx");
  const exportRoute=read("../app/dashboard/fastq-qc/[id]/export/route.ts");
  const workbench=read("../app/dashboard/fastq-qc/fastq-qc-workbench.tsx");
  assert.match(sql,/alter table public\.fastq_qc_snapshots enable row level security/);
  assert.match(sql,/fastq_qc_select_owner/);
  assert.match(sql,/fastq_qc_insert_owner/);
  assert.match(sql,/fastq_qc_delete_owner/);
  assert.match(sql,/revoke all on public\.fastq_qc_snapshots from public,anon/);
  assert.match(sql,/guard_fastq_qc_snapshot/);
  assert.match(sql,/client_computed_unverified/);
  assert.match(sql,/new\.summary-array/);
  assert.match(sql,/jsonb_array_elements\(item->'perCycle'\)/);
  assert.doesNotMatch(sql,/raw_reads text|genotypes text|read_headers text/);
  assert.match(actions,/getClaims\(\)/);
  assert.match(actions,/validateFastqQcSummary\(raw\)/);
  assert.match(actions,/\.from\("fastq_qc_snapshots"\)\.insert/);
  assert.doesNotMatch(actions,/createServiceClient\s*\(|SUPABASE_SECRET_KEY|raw_fastq:/);
  assert.match(page,/\.eq\("created_by",userId\)/);
  assert.match(saved,/\.eq\("created_by",owner\)/);
  assert.match(exportRoute,/\.eq\("created_by",owner\)/);
  assert.match(exportRoute,/no-store/);
  assert.match(workbench,/crypto\.subtle\.digest\("SHA-256",bytes\)/);
  assert.match(workbench,/new TextDecoder\("utf-8",\{fatal:true\}\)/);
  assert.doesNotMatch(workbench,/fetch\(["']https?:|localStorage|indexedDB/);
});

test("V39 FASTQ module is discoverable throughout Genithm",()=>{
  const nav=read("../components/dashboard-primary-nav.tsx");
  const dock=read("../components/genithm-tool-dock.tsx");
  const sidebar=read("../components/research-chat-sidebar.tsx");
  const results=read("../app/dashboard/results/page.tsx");
  const types=read("../lib/report-database.types.ts");
  assert.match(nav,/href:"\/dashboard\/fastq-qc"/);
  assert.match(dock,/href:"\/dashboard\/fastq-qc"/);
  assert.match(sidebar,/href="\/dashboard\/fastq-qc"/);
  assert.match(results,/href="\/dashboard\/fastq-qc"/);
  assert.match(types,/fastq_qc_snapshots: FastqQcSnapshot/);
});
