import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseVcfQc, validateVcfQcSummary, vcfQcSummaryTsv,
  MAX_VCF_BYTES, MAX_VCF_RECORDS, VCF_QC_VERSION,
} from "../lib/vcf-quality-control.ts";

const read = path => readFileSync(new URL(path,import.meta.url),"utf8");
const fields="#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO";
const vcf=[
 "##fileformat=VCFv4.2","##source=Genithm-unit-test",
 fields,
 "chr1\t10\t.\tA\tG\t50\tPASS\t.",
 "chr1\t11\t.\tC\tT\t99\tq10\t.",
 "chr2\t12\t.\tG\tC\t.\t.\t.",
 "chr2\t13\t.\tA\tAT\t10\tPASS\t.",
 "chr2\t14\t.\tAT\tA\t20\tLowQual\t.",
 "chr3\t15\t.\tAT\tGC\t45\tPASS\t.",
 "chr3\t16\t.\tA\tG,T\t24\tPASS\t.",
 "chr3\t17\t.\tA\t<DEL>\t30\tPASS\t.",
].join("\n");
const sha="abc123ef".repeat(8);

test("V38 computes actual record classifications, Ti/Tv, quality and chromosome distributions",()=>{
  const {summary,preview}=parseVcfQc(vcf);
  assert.equal(summary.analyzerVersion,VCF_QC_VERSION);
  assert.equal(summary.totalRecords,8);
  assert.deepEqual(summary.variantCounts,{
    SNV:3,MNV:1,insertion:1,deletion:1,complex:1,multiallelic:1,
  });
  assert.deepEqual(summary.filterCounts,{pass:5,filtered:2,missing:1});
  assert.deepEqual(summary.qualityBins,[0,1,2,1,2,1,0]);
  assert.equal(summary.missingQual,1);
  assert.equal(summary.transitions,2);
  assert.equal(summary.transversions,1);
  assert.equal(summary.distinctChromosomes,3);
  assert.deepEqual(summary.chromCounts,[
    {chrom:"chr2",count:3},{chrom:"chr3",count:3},{chrom:"chr1",count:2},
  ]);
  assert.equal(preview.length,8);
  assert.equal(preview[7].category,"complex");
  assert.ok(validateVcfQcSummary(summary));
});

test("V38 can inspect VCFs with genotype columns but does not analyze genotype values",()=>{
  const sample=vcf.split("\n").slice(0,3).join("\n")
    .replace(fields,fields+"\tFORMAT\tprivate-sample")+
    "\nchr1\t12\t.\tA\tG\t25\tPASS\t.\tGT\t0/1";
  const result=parseVcfQc(sample);
  assert.equal(result.summary.totalRecords,1);
  assert.equal(result.summary.sampleColumns,1);
  assert.equal(result.summary.transitions,1);
  assert.equal(result.preview[0].alt,"G");
  assert.equal(Object.keys(result.preview[0]).includes("genotype"),false);
  const json=JSON.stringify(result.summary);
  assert.ok(!json.includes("private-sample"));
  assert.ok(!json.includes("0/1"));
});

test("V38 rejects invalid VCF structures without guessing scientific data",()=>{
  const invalid=[
    "chrom\tpos",
    vcf.replace("##fileformat=VCFv4.2","##fileformat=VCFv3.3"),
    vcf.replace("chr1\t10","chr1\t0"),
    vcf.replace("A\tG\t50","A\tG\t-1"),
    vcf.replace("A\tG\t50","A\tG\tNaN"),
    vcf.replace("A\tG\t50","A\tG\tInfinity"),
    vcf.replace("A\tG\t50","?\tG\t50"),
    vcf.replace("A\tG\t50","A\t[X]\t50"),
    vcf.replace("A\tG\t50\tPASS","A\tG\t50\tPASS;bad"),
    vcf.replace("chr1\t10\t.\tA\tG\t50\tPASS\t.","chr1\t10\t.\tA\tG\t50\tPASS"),
    vcf.replace("chr1\t10\t.\tA\tG\t50\tPASS\t.","#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO"),
    vcf+"\u0000",
  ];
  for(const input of invalid){
    assert.throws(()=>parseVcfQc(input),{name:"VcfQcError"});
  }
  assert.throws(()=>parseVcfQc("a".repeat(MAX_VCF_BYTES+1)),/exceeds/);
});

test("V38 persists only valid nonfabricated aggregate shapes",()=>{
  const source=parseVcfQc(vcf).summary;
  const mutations=[
    {...source,totalRecords:9},
    {...source,transitions:100},
    {...source,variantCounts:{...source.variantCounts,SNV:4}},
    {...source,filterCounts:{pass:8,filtered:3,missing:1}},
    {...source,qualityBins:[1,2]},
    {...source,missingQual:2},
    {...source,chromCounts:[{chrom:"chr1",count:1}]},
    {...source,sampleColumns:101},
    {...source,analyzerVersion:"unknown"},
  ];
  for(const mutant of mutations)assert.equal(validateVcfQcSummary(mutant),false);
  assert.equal(validateVcfQcSummary(source),true);
  assert.ok(MAX_VCF_RECORDS===50000);
});

test("V38 safe TSV includes exact counts and honest verification caveat",()=>{
  const report=vcfQcSummaryTsv(parseVcfQc(vcf).summary,sha);
  assert.match(report,/client-computed; no server-side source verification/);
  assert.match(report,/SNV\t3/);
  assert.match(report,/Ti\/Tv \(biallelic canonical SNVs only\)\t2/);
  assert.match(report,/chr2\t3/);
  assert.ok(report.includes(sha));
  assert.throws(()=>vcfQcSummaryTsv(parseVcfQc(vcf).summary,"invalid"),/fingerprint/);
});

test("V38 aggregate-only saving and report retrieval uses end-user Supabase RLS",()=>{
  const migration=read("../../../supabase/migrations/20261016180000_variant_qc_snapshots_v38.sql");
  const save=read("../app/dashboard/variant-qc/actions.ts");
  const page=read("../app/dashboard/variant-qc/page.tsx");
  const saved=read("../app/dashboard/variant-qc/[id]/page.tsx");
  const exportRoute=read("../app/dashboard/variant-qc/[id]/export/route.ts");
  const workbench=read("../app/dashboard/variant-qc/variant-qc-workbench.tsx");
  assert.match(migration,/enable row level security/);
  assert.match(migration,/create policy variant_qc_snapshots_select_owner/);
  assert.match(migration,/create policy variant_qc_snapshots_insert_owner/);
  assert.match(migration,/create policy variant_qc_snapshots_delete_owner/);
  assert.match(migration,/revoke all on public\.variant_qc_snapshots from public, anon/);
  assert.match(migration,/client_computed_unverified/);
  assert.doesNotMatch(migration,/raw_vcf|genotype_records|sample_names|variant_rows/);
  assert.match(save,/getClaims\(\)/);
  assert.match(save,/validateVcfQcSummary\(summary\)/);
  assert.match(save,/\.from\("variant_qc_snapshots"\)\.insert/);
  assert.doesNotMatch(save,/file\.arrayBuffer|createServiceClient\s*\(|service_role\s*:/);
  assert.match(page,/\.eq\("created_by",userId\)/);
  assert.match(saved,/\.eq\("created_by",userId\)/);
  assert.match(exportRoute,/Cache-Control/);
  assert.match(exportRoute,/no-store/);
  assert.match(exportRoute,/\.eq\("created_by",userId\)/);
  assert.match(workbench,/crypto\.subtle\.digest\("SHA-256",data\)/);
  assert.match(workbench,/new TextDecoder\("utf-8",\{fatal:true\}\)/);
  assert.doesNotMatch(workbench,/fetch\(["']https?:|localStorage|indexedDB/);
});

test("V38 laboratory is visible from Genithm primary workspace and its tools",()=>{
  const nav=read("../components/dashboard-primary-nav.tsx");
  const dock=read("../components/genithm-tool-dock.tsx");
  const sidebar=read("../components/research-chat-sidebar.tsx");
  const results=read("../app/dashboard/results/page.tsx");
  const types=read("../lib/report-database.types.ts");
  assert.match(nav,/href:"\/dashboard\/variant-qc"/);
  assert.match(dock,/href: "\/dashboard\/variant-qc"/);
  assert.match(sidebar,/href="\/dashboard\/variant-qc"/);
  assert.match(results,/href="\/dashboard\/variant-qc"/);
  assert.match(types,/variant_qc_snapshots: VariantQcSnapshot/);
});
