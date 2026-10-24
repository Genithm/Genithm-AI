import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {parseVerifiedResearchFile,assertMatchingEvidence,withVerifiedVcfSiteEvidence}
  from '../lib/verified-research-files.ts';
import {isVerifiedVcfComparisonRequest,renderVerifiedVcfComparison}
  from '../lib/verified-vcf-comparison.ts';

const project='f0ad3605-32bc-4f22-ac43-497693233c0a';
const ids=['814a4c27-9928-477e-8032-784c86f40e4f','b5a9ef60-0a73-4924-9644-a73a31f65713'];
const hashes=['a'.repeat(64),'c'.repeat(64)];
const reportHashes=['b'.repeat(64),'d'.repeat(64)];
const metric={
 schema:'genithm-vcf-site-qc/1',engine_version:'genithm-vcf-stream/1.0.0',
 sampling:false,genotypes_inspected:false,record_count:10,sample_count:2,contigs_seen:1,
 snv_sites:6,mnv_sites:0,indel_sites:2,complex_sites:0,symbolic_sites:1,
 reference_only_sites:1,multiallelic_sites:1,canonical_snv_alt_alleles:5,
 transitions:2,transversions:3,pass_sites:7,failed_filter_sites:2,unfiltered_sites:1,
 quality_available_sites:8,missing_quality_sites:2,mean_qual:30.25,expanded_bytes:654
};
function file(index=0, overrides={}) {
 const sourceMetric={...metric};
 if(index===1)Object.assign(sourceMetric,{record_count:20,snv_sites:12,indel_sites:4,symbolic_sites:2,
    reference_only_sites:2,canonical_snv_alt_alleles:10,transitions:4,transversions:6,
    pass_sites:15,failed_filter_sites:3,unfiltered_sites:2,
    quality_available_sites:18,missing_quality_sites:2,mean_qual:42.5,expanded_bytes:1221});
 Object.assign(sourceMetric,overrides);
 const input={record_id:ids[index],project_id:project,report:{
   schema:'genithm-large-data-result/1',verification:'whole_object_sha256',
   source_sha256:hashes[index],report_sha256:reportHashes[index],
   source_bytes:index===0?456:824,format:'opaque',scientific_scope:'full_vcf_site_qc',
   metrics:sourceMetric,intake:{registry_version:'genithm-file-registry/2',mode:'auto',
     inspection:'complete_vcf',name_hint:{format_id:'vcf'}}}};
 return parseVerifiedResearchFile(input,ids[index],project);
}
function selected() {return [file(0),file(1)];}
function snapshot(rows) {
 return rows.map(file=>({id:file.id,project_id:file.project_id,source_sha256:file.source_sha256,
   report_sha256:file.report_sha256,source_bytes:file.source_bytes,format:file.format,
   scientific_scope:file.scientific_scope,inspection:file.inspection,fastq:null,fasta:null}));
}

test('V66 compares two real verified VCF aggregates with exact PASS% and allele Ti/Tv',()=>{
 const files=selected();const message='Compare these VCF QC reports';
 const bound=snapshot(files);assertMatchingEvidence(bound,files);
 assert.equal(isVerifiedVcfComparisonRequest(message,files),true);
 const compared=renderVerifiedVcfComparison(message,files);
 assert.match(compared,/VCF 1 \(aaaaaaaaaaaa\).*10.*6.*2.*1.*1.*7 \(70\.00%\).*0\.67.*30\.25.*2/);
 assert.match(compared,/VCF 2 \(cccccccccccc\).*20.*12.*4.*2.*1.*15 \(75\.00%\).*0\.67.*42\.50.*2/);
 assert.match(compared,/same selection order/);
 assert.match(compared,/not a per-site ratio/);
 assert.doesNotMatch(compared,/sample-ID|patient-|private-variant|chr[0-9]+:|0\/1/);
 const context={selected_verified_research_files:bound};
 const verified=withVerifiedVcfSiteEvidence(context,files);
 assert.equal(verified.selected_verified_research_files[0].vcf_site_qc.snv_sites,6);
 assert.equal(context.selected_verified_research_files[0].vcf_site_qc,undefined);
});

test('V66 never claims zero transversions yields a finite Ti/Tv and handles missing QUAL',()=>{
 const changed=file(0,{canonical_snv_alt_alleles:0,transitions:0,transversions:0,
   quality_available_sites:0,missing_quality_sites:10,mean_qual:null});
 const reply=renderVerifiedVcfComparison('side by side comparison',[changed,file(1)]);
 assert.match(reply,/n\/a \(no transversions\)/);
 assert.match(reply,/Mean available QUAL/);
 assert.match(reply,/n\/a/);
 assert.doesNotMatch(reply,/\bInfinity\b|\bNaN\b/);
});

test('V66 explicitly refuses unsupported variant overlap claims, but shows verified QC counts',()=>{
 const reply=renderVerifiedVcfComparison('Compare the shared variants or genotype concordance of these VCF files',selected());
 assert.match(reply,/cannot.*establish which variants overlap/);
 assert.match(reply,/not analyzed.*genotype/i);
 assert.match(reply,/PASS sites \(%\)/);
});

test('V66 fails closed for one, five, duplicate, mixed-project or unverified files',()=>{
 const both=selected();const message='compare these reports';
 assert.equal(isVerifiedVcfComparisonRequest(message,both.slice(0,1)),false);
 assert.equal(isVerifiedVcfComparisonRequest(message,[...both,both[0]]),false);
 assert.equal(isVerifiedVcfComparisonRequest(message,Array(5).fill(both[0])),false);
 assert.equal(isVerifiedVcfComparisonRequest(message,[both[0],{...both[1],project_id:ids[0]}]),false);
 assert.equal(isVerifiedVcfComparisonRequest(message,[both[0],{...both[1],source_sha256:'!'}]),false);
 assert.equal(isVerifiedVcfComparisonRequest(message,[both[0],{...both[1],vcf_site_qc:undefined}]),false);
 assert.equal(isVerifiedVcfComparisonRequest('What does this single report mean?',both),false);
 assert.throws(()=>renderVerifiedVcfComparison(message,both.slice(0,1)));
});

test('V66 rejects contradictory and negative numbers in an apparently verified comparison',()=>{
 const both=selected();
 assert.throws(()=>renderVerifiedVcfComparison('compare',[both[0],{...both[1],vcf_site_qc:{...both[1].vcf_site_qc,pass_sites:99}}]));
 assert.throws(()=>renderVerifiedVcfComparison('compare',[both[0],{...both[1],vcf_site_qc:{...both[1].vcf_site_qc,indel_sites:-1}}]));
 assert.throws(()=>renderVerifiedVcfComparison('compare',[both[0],{...both[1],vcf_site_qc:{...both[1].vcf_site_qc,mean_qual:Number.POSITIVE_INFINITY}}]));
});

test('V66 route persists numeric scientific comparison before any model streaming',()=>{
 const route=readFileSync(new URL('../app/api/ai/chat/route.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../components/research-file-selector.tsx',import.meta.url),'utf8');
 assert.match(route,/assertMatchingEvidence\(\(context as Record<string,unknown>\)\.selected_verified_research_files, verifiedFiles\)/);
 assert.match(route,/withVerifiedVcfSiteEvidence\(context,verifiedFiles\)/);
 assert.match(route,/isVerifiedVcfComparisonRequest\(row\.user_message,verifiedFiles\)/);
 const comparison=route.indexOf('isVerifiedVcfComparisonRequest(row.user_message,verifiedFiles)');
 const model=route.indexOf('const providerResult = await startStreamingChat(',comparison);
 const persisted=route.indexOf('await service.rpc("finish_ai_chat_turn"',comparison);
 assert.ok(comparison>0&&persisted>comparison&&model>persisted);
 assert.match(route.slice(comparison,model),/if\(finishError\)throw new Error/);
 assert.match(route.slice(comparison,model),/return;/);
 assert.match(route.slice(comparison-160,comparison),/!attachmentIds\.length && !localFiles\.length && !mediaAttachments\.length/);
 assert.match(ui,/Compare these VCF QC reports/);
});
