import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
 parseVerifiedResearchFile,assertMatchingEvidence,withVerifiedVcfSiteEvidence,loadVerifiedResearchFiles
} from '../lib/verified-research-files.ts';

const pid='f0ad3605-32bc-4f22-ac43-497693233c0a';
const fid='814a4c27-9928-477e-8032-784c86f40e4f';
const sha='a'.repeat(64), reportSha='b'.repeat(64);
const metrics={schema:'genithm-vcf-site-qc/1',engine_version:'genithm-vcf-stream/1.0.0',
 sampling:false,genotypes_inspected:false,record_count:3,sample_count:2,contigs_seen:1,
 snv_sites:1,mnv_sites:0,indel_sites:1,complex_sites:0,symbolic_sites:1,
 reference_only_sites:0,multiallelic_sites:0,canonical_snv_alt_alleles:1,transitions:1,
 transversions:0,pass_sites:1,failed_filter_sites:1,unfiltered_sites:1,
 quality_available_sites:2,missing_quality_sites:1,mean_qual:37.5,expanded_bytes:240};
const envelope={record_id:fid,project_id:pid,report:{
 schema:'genithm-large-data-result/1',verification:'whole_object_sha256',
 source_sha256:sha,report_sha256:reportSha,source_bytes:200,format:'opaque',
 scientific_scope:'full_vcf_site_qc',intake:{
  schema:'genithm-file-intake/1',registry_version:'genithm-file-registry/2',
  mode:'auto',inspection:'complete_vcf',name_hint:{format_id:'vcf'}},
 metrics}};
const snapshot={id:fid,project_id:pid,filename:'research.vcf.gz',source_sha256:sha,
 report_sha256:reportSha,source_bytes:200,format:'opaque',scientific_scope:'full_vcf_site_qc',
 inspection:'complete_vcf',fastq:null,fasta:null};
const clone=()=>structuredClone(envelope);
test('V65 parsed VCF report contains only approved numeric and boolean fields, no raw rows',()=>{
 const source=clone();
 source.report.metrics.private_sample_names=['patient-1234'];
 source.report.metrics.private_variant_rows=['chr1:100 A>G'];
 const vcf=parseVerifiedResearchFile(source,fid,pid);
 assert.equal(vcf.scientific_scope,'full_vcf_site_qc');
 assert.equal(vcf.vcf_site_qc.record_count,3);
 assert.equal(vcf.vcf_site_qc.transitions,1);
 assert.equal(vcf.vcf_site_qc.mean_qual,37.5);
 const text=JSON.stringify(vcf);
 assert.doesNotMatch(text,/patient|chr1|private_/);
 assert.equal(Object.keys(vcf.vcf_site_qc).length,18);
});
test('V65 DB snapshot must prove same scoped source/report sha before enrichment',()=>{
 const verified=parseVerifiedResearchFile(clone(),fid,pid);
 assertMatchingEvidence([snapshot],[verified]);
 const context={project_id:pid,selected_verified_research_files:[snapshot],other_context:{id:'db'}};
 const result=withVerifiedVcfSiteEvidence(context,[verified]);
 assert.equal(result.selected_verified_research_files[0].vcf_site_qc.snv_sites,1);
 assert.equal(context.selected_verified_research_files[0].vcf_site_qc,undefined);
 assert.deepEqual(result.other_context,{id:'db'});
 assert.throws(()=>withVerifiedVcfSiteEvidence({...context,selected_verified_research_files:[{...snapshot,source_sha256:'c'.repeat(64)}]},[verified]));
 assert.throws(()=>withVerifiedVcfSiteEvidence({...context,selected_verified_research_files:[{...snapshot,report_sha256:'c'.repeat(64)}]},[verified]));
 assert.throws(()=>withVerifiedVcfSiteEvidence({...context,selected_verified_research_files:[{...snapshot,project_id:'a'.repeat(36)}]},[verified]));
});
test('V65 does not elevate integrity-only or legacy VCF to real scientific analysis',()=>{
 for(const [scope,inspection] of [['bytes_only','integrity_only'],['full_vcf_site_qc','legacy'],['full_vcf_site_qc','integrity_only']]){
  const obj=clone();obj.report.scientific_scope=scope;obj.report.intake.inspection=inspection;
  if(scope==='bytes_only')obj.report.metrics=null;
  if(scope==='bytes_only'){
    const v=parseVerifiedResearchFile(obj,fid,pid);
    assert.equal(v.vcf_site_qc,undefined);
    assert.throws(()=>assertMatchingEvidence([{...snapshot,scientific_scope:'bytes_only',inspection:'integrity_only',vcf_site_qc:{record_count:4}}],[v]));
  }else assert.throws(()=>parseVerifiedResearchFile(obj,fid,pid));
 }
});
test('V65 rejects contradictory site totals, false sampling claims, invalid mean and missing proof',()=>{
 const cases=[
  o=>{o.report.metrics.snv_sites=2;},
  o=>{o.report.metrics.pass_sites=5;},
  o=>{o.report.metrics.quality_available_sites=3;},
  o=>{o.report.metrics.canonical_snv_alt_alleles=4;},
  o=>{o.report.metrics.sampling=true;},
  o=>{o.report.metrics.genotypes_inspected=true;},
  o=>{o.report.metrics.mean_qual=Infinity;},
  o=>{o.report.metrics.mean_qual=1000001;},
  o=>{o.report.intake.registry_version='genithm-file-registry/1';},
  o=>{o.report.intake.name_hint.format_id='bam';},
  o=>{o.report.format='fastq';},
  o=>{o.report.report_sha256='invalid';}
 ];
 for(const change of cases){const o=clone();change(o);assert.throws(()=>parseVerifiedResearchFile(o,fid,pid));}
});
test('V65 SQL authenticated snapshot and VCF report come from private API, never raw file download',async()=>{
 const old=globalThis.fetch;
 const oldApi=process.env.NEXT_PUBLIC_GENITHM_API_URL;
 process.env.NEXT_PUBLIC_GENITHM_API_URL='http://localhost:8000';
 const calls=[];
 globalThis.fetch=async (url,opts)=>{calls.push([url,opts]);return new Response(JSON.stringify(envelope),{status:200});};
 try{
  const rows=await loadVerifiedResearchFiles([fid],pid,'verified-bearer',new AbortController().signal);
  assert.equal(rows[0].vcf_site_qc.indel_sites,1);
  assert.equal(calls.length,1);
  assert.match(calls[0][0],new RegExp('/uploads/'+fid+'/file-report$'));
  assert.equal(calls[0][1].headers.Authorization,'Bearer verified-bearer');
  assert.equal(calls[0][1].redirect,'error');
  assert.equal(calls[0][1].cache,'no-store');
 }finally{globalThis.fetch=old;
  if(oldApi===undefined)delete process.env.NEXT_PUBLIC_GENITHM_API_URL;
  else process.env.NEXT_PUBLIC_GENITHM_API_URL=oldApi;}
});
test('V65 route connects only DB digest-bound VCF site QC to model chat, not execution',()=>{
 const route=readFileSync(new URL('../app/api/ai/chat/route.ts',import.meta.url),'utf8');
 const policy=readFileSync(new URL('../lib/genithm-ai-chat.ts',import.meta.url),'utf8');
 assert.match(route,/assertMatchingEvidence\(\(context as Record<string,unknown>\)\.selected_verified_research_files, verifiedFiles\)/);
 assert.match(route,/withVerifiedVcfSiteEvidence\(context,verifiedFiles\)/);
 assert.match(route,/startStreamingChat\(\s*row\.user_message,\s*conversationalContext,/);
 assert.doesNotMatch(route,/file-report.*content\W*buffer/i);
 assert.match(policy,/site-level QC/);
});
