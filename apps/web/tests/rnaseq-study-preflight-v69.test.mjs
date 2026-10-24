import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 RNASEQ_PINNED_VERSION, RNASEQ_MAX_MANIFEST_BYTES,
 validateRnaSeqStudy,RnaSeqIntakeError
} from "../lib/rnaseq-study-preflight.ts";

const samples=["sample,fastq_1,fastq_2,strandedness",
 "C1,seq/C1_R1.fastq.gz,seq/C1_R2.fastq.gz,auto",
 "C1,seq/C1_L002_R1.fastq.gz,seq/C1_L002_R2.fastq.gz,auto",
 "C2,seq/C2_R1.fastq.gz,seq/C2_R2.fastq.gz,auto",
 "C3,seq/C3_R1.fastq.gz,seq/C3_R2.fastq.gz,auto",
 "T1,seq/T1_R1.fastq.gz,seq/T1_R2.fastq.gz,auto",
 "T2,seq/T2_R1.fastq.gz,seq/T2_R2.fastq.gz,auto",
 "T3,seq/T3_R1.fastq.gz,seq/T3_R2.fastq.gz,auto"].join("\n")+"\n";
const design=["sample,condition","T3,treated","C2,control","C1,control",
 "T1,treated","C3,control","T2,treated"].join("\n")+"\n";
const err=(fn,code)=>assert.throws(fn,x=>x instanceof RnaSeqIntakeError&&x.code===code);

test("V69 real metadata validation joins sample identities, not row order or number of lanes",()=>{
 const result=validateRnaSeqStudy(samples,design);
 assert.equal(result.schema,"genithm-rnaseq-study-preflight/1");
 assert.equal(result.pipeline.version,RNASEQ_PINNED_VERSION);
 assert.equal(result.lanes,7);
 assert.equal(result.samples,6);
 assert.equal(result.technical_replicate_samples,1);
 assert.equal(result.paired_end_lanes,7);
 assert.equal(result.single_end_lanes,0);
 assert.deepEqual(result.groups,[{condition:"control",biological_samples:3},
 {condition:"treated",biological_samples:3}]);
 assert.equal(result.exploratory_two_group_design_sufficient,true);
 assert.equal(result.status,"metadata_validated_not_executed");
 assert.deepEqual(Object.values(result.prerequisites),Array(6).fill(false));
 assert.match(result.warnings.join(" "),/not opened/);
 assert.match(result.warnings.join(" "),/No alignment, Salmon quantification, differential expression/);
 assert.match(result.nfcore_samplesheet_csv,/seq\/C1_L002_R1\.fastq\.gz/);
 const repeated=validateRnaSeqStudy(result.nfcore_samplesheet_csv,result.experimental_design_csv);
 assert.deepEqual(repeated,result);
});

test("V69 safe CSV parsing accepts BOM CRLF and quoted fields, never infers file existence",()=>{
 const sheet="\uFEFFsample,fastq_1,fastq_2,strandedness,seq_platform,seq_center\r\n"+
  '"C1","sample/C1_R1.fastq.gz","sample/C1_R2.fastq.gz","reverse","ILLUMINA","LAB1"\r\n'+
  '"T1","sample/T1_R1.fastq.gz","sample/T1_R2.fastq.gz","reverse","ILLUMINA","LAB1"\r\n';
 const result=validateRnaSeqStudy(sheet,"sample,condition\r\nT1,treatment\r\nC1,control\r\n");
 assert.equal(result.samples,2);
 assert.equal(result.groups[0].condition,"control");
 assert.equal(result.exploratory_two_group_design_sufficient,false);
 assert.match(result.warnings.join(" "),/fewer than three biological replicates/);
 assert.match(result.nfcore_samplesheet_csv,/seq_platform,seq_center/);
 assert.ok(result.nfcore_samplesheet_csv.startsWith("sample,fastq_1"));
});

test("V69 rejects untrusted paths, remote URLs, shell delimiters, traversal and spreadsheet injections",()=>{
 for(const bad of [
  "../secret.fastq.gz","/etc/passwd.fastq.gz","https://example.org/a.fastq.gz",
  "s3://my-bucket/a.fastq.gz","a/../secret.fastq.gz","a/./secret.fastq.gz",
  "a//reads.fastq.gz","~/.ssh/x.fastq.gz","$(evil).fastq.gz",
  "=HYPERLINK(1).fastq.gz","@cmd.fastq.gz","a;touch.fastq.gz",
  "a\\folder.fastq.gz","a b.fastq.gz","reads.bam"
 ]){
  const sheet=samples.replace("seq/C1_R1.fastq.gz",bad);
  err(()=>validateRnaSeqStudy(sheet,design),"path");
 }
});

test("V69 rejects reused source, mismatched lane type and missing or duplicated biological samples",()=>{
 err(()=>validateRnaSeqStudy(samples.replace("seq/C2_R1.fastq.gz","seq/C1_R1.fastq.gz"),design),"duplicate_path");
 err(()=>validateRnaSeqStudy(samples.replace("C1,seq/C1_L002_R1.fastq.gz,seq/C1_L002_R2.fastq.gz,auto",
  "C1,seq/C1_L002_R1.fastq.gz,,auto"),design),"technical_lanes");
 err(()=>validateRnaSeqStudy(samples,design.replace("T3,treated","C1,treated")),"duplicate_design");
 err(()=>validateRnaSeqStudy(samples,design.replace("T3,treated","MISSING,treated")),"foreign_design");
 err(()=>validateRnaSeqStudy(samples,design.replace("T3,treated\n","")),"missing_design");
 err(()=>validateRnaSeqStudy(samples,design.replaceAll("treated","control")),"contrast");
});

test("V69 rejects malformed header, ambiguous fields, non-CSV and hostile control characters",()=>{
 const cases=[
 ["sample,fastq_1,fastq_1,strandedness\nS1,a.fastq,,auto\n","header"],
 ["sample,fastq_1,fastq_2,strandedness,unknown\nS1,a.fastq,,auto,1\n","header"],
 ["sample,fastq_1,fastq_2,strandedness\nS1,a.fastq,,auto,extra\n","columns"],
 ["sample,fastq_1,fastq_2,strandedness\nS1,\"a.fastq,,auto\n","quotes"],
 ["sample,fastq_1,fastq_2,strandedness\nS1,garbage\n","columns"],
 ["sample,fastq_1,fastq_2,strandedness\nS1,seq/one.fastq,,auto\u0000\n","control"],
 ["sample,fastq_1,fastq_2,strandedness\nS1,a.fastq,,UNSTRANDED\n","strandedness"],
 ["sample,fastq_1,fastq_2,strandedness\nS1,a.fastq,,auto\nS2,b.fastq,,auto\n","missing_design"]
 ];
 for(const [sheet,code] of cases)err(()=>validateRnaSeqStudy(sheet,design),code);
 err(()=>validateRnaSeqStudy("x".repeat(RNASEQ_MAX_MANIFEST_BYTES+1),design),"size");
 err(()=>validateRnaSeqStudy("",design),"empty");
});

test("V69 validates technical lanes but never silently counts them as biological replicates",()=>{
 const sheet=["sample,fastq_1,fastq_2,strandedness",
 "CTRL,control_1.fastq.gz,,auto",
 "CTRL,control_2.fastq.gz,,auto",
 "CASE,case_1.fastq.gz,,auto"].join("\n")+"\n";
 const d="sample,condition\nCTRL,control\nCASE,treated\n";
 const r=validateRnaSeqStudy(sheet,d);
 assert.equal(r.samples,2);assert.equal(r.lanes,3);
 assert.equal(r.technical_replicate_samples,1);
 assert.equal(r.paired_end_lanes,0);
 assert.equal(r.exploratory_two_group_design_sufficient,false);
});

test("V69 UI enforces authenticated entry and local-only analysis, visible in the real app",()=>{
 const page=readFileSync(new URL("../app/dashboard/rnaseq/page.tsx",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../app/dashboard/rnaseq/rnaseq-preflight-workbench.tsx",import.meta.url),"utf8");
 const lib=readFileSync(new URL("../lib/rnaseq-study-preflight.ts",import.meta.url),"utf8");
 assert.match(page,/supabase\.auth\.getClaims\(\)/);
 assert.match(page,/redirect\("\/login"\)/);
 assert.match(ui,/validateRnaSeqStudy\(sheet,design\)/);
 assert.match(ui,/crypto\.subtle\.digest\("SHA-256"/);
 assert.match(ui,/Metadata validated/);
 assert.match(ui,/not uploaded, opened or analyzed/);
 assert.match(lib,/output_quantification_completed:false/);
 assert.match(lib,/private_compute_available:false/);
 assert.doesNotMatch(lib,/execSync|spawn\(|fetch\(|eval\(/);
 assert.doesNotMatch(ui,/fetch\(|axios|supabase\.from\(/);
});
