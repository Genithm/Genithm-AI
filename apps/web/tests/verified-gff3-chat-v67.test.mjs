import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseVerifiedResearchFile,assertMatchingEvidence,withVerifiedVcfSiteEvidence} from '../lib/verified-research-files.ts';

const id='814a4c27-9928-477e-8032-784c86f40e4f';
const project='f0ad3605-32bc-4f22-ac43-497693233c0a';
const digest='a'.repeat(64),reportDigest='b'.repeat(64);
const metrics={
 schema:'genithm-gff3-feature-qc/1',engine_version:'genithm-gff3-stream/1.0.0',
 sampling:false,attributes_interpreted:false,embedded_fasta:false,embedded_fasta_validated:false,
 feature_rows:3,gene_features:1,transcript_features:1,exon_features:1,cds_features:0,
 utr_features:0,other_features:0,plus_features:2,minus_features:1,
 unstranded_features:0,unknown_strand_features:0,phased_cds_rows:0,unphased_cds_rows:0,
 contigs_seen:1,total_feature_span_bp:23,minimum_feature_bp:5,maximum_feature_bp:10,
 expanded_bytes:240,mean_feature_bp:7.666667
};
function envelope(){
 return {record_id:id,project_id:project,report:{
  schema:'genithm-large-data-result/1',verification:'whole_object_sha256',
  source_sha256:digest,report_sha256:reportDigest,source_bytes:230,
  format:'opaque',scientific_scope:'full_gff3_feature_qc',
  metrics:structuredClone(metrics),
  intake:{registry_version:'genithm-file-registry/3',mode:'auto',inspection:'complete_gff3',
   name_hint:{format_id:'gff',available_inspection:'complete_gff3'}}
 }};
}
function snapshot(){
 return {id,project_id:project,source_sha256:digest,report_sha256:reportDigest,
  source_bytes:230,format:'opaque',scientific_scope:'full_gff3_feature_qc',
  inspection:'complete_gff3',fastq:null,fasta:null};
}
test('V67 GFF3 evidence is an explicit numeric allowlist, not genomic content',()=>{
 const source=envelope();
 source.report.metrics.raw_ids=['patient-1001'];source.report.metrics.raw_contigs=['chr19'];
 source.report.metrics.raw_attributes='Pathogenic SNP';
 const result=parseVerifiedResearchFile(source,id,project);
 assert.equal(result.gff3_feature_qc.feature_rows,3);
 assert.equal(result.gff3_feature_qc.total_feature_span_bp,23);
 assert.equal(result.gff3_feature_qc.mean_feature_bp,7.666667);
 const text=JSON.stringify(result);
 assert.doesNotMatch(text,/patient|chr19|Pathogenic|raw_/);
 assert.equal(Object.keys(result.gff3_feature_qc).length,23);
});
test('V67 only sends GFF3 numbers for DB-bound matching source and report hashes',()=>{
 const verified=parseVerifiedResearchFile(envelope(),id,project);
 assertMatchingEvidence([snapshot()],[verified]);
 const original={selected_verified_research_files:[snapshot()],project_id:project};
 const context=withVerifiedVcfSiteEvidence(original,[verified]);
 assert.equal(context.selected_verified_research_files[0].gff3_feature_qc.gene_features,1);
 assert.equal(original.selected_verified_research_files[0].gff3_feature_qc,undefined);
 for(const wrong of [
  {...snapshot(),source_sha256:'c'.repeat(64)},
  {...snapshot(),report_sha256:'d'.repeat(64)},
  {...snapshot(),id:'a'.repeat(36)},
  {...snapshot(),inspection:'integrity_only'}
 ])assert.throws(()=>withVerifiedVcfSiteEvidence({selected_verified_research_files:[wrong]},[verified]));
});
test('V67 rejects fake rows, old registry claims, uninspected and modified counts',()=>{
 const mutations=[
  o=>{o.report.metrics.exon_features=7;},
  o=>{o.report.metrics.plus_features=3;},
  o=>{o.report.metrics.phased_cds_rows=1;},
  o=>{o.report.metrics.minimum_feature_bp=30;},
  o=>{o.report.metrics.mean_feature_bp=NaN;},
  o=>{o.report.metrics.attributes_interpreted=true;},
  o=>{o.report.metrics.embedded_fasta_validated=true;},
  o=>{o.report.metrics.sampling=true;},
  o=>{o.report.intake.registry_version='genithm-file-registry/2';},
  o=>{o.report.intake.mode='preserve';},
  o=>{o.report.intake.inspection='integrity_only';},
  o=>{o.report.intake.name_hint.format_id='vcf';},
  o=>{o.report.report_sha256='broken';}
 ];
 for(const change of mutations){const x=envelope();change(x);assert.throws(()=>parseVerifiedResearchFile(x,id,project));}
 const bytesOnly=envelope();bytesOnly.report.scientific_scope='bytes_only';
 bytesOnly.report.intake.inspection='integrity_only';bytesOnly.report.metrics=null;
 assert.throws(()=>parseVerifiedResearchFile(bytesOnly,id,project));
});
test('V67 keeps v2 VCF and v3 VCF accepted without any GFF3 escalation',()=>{
 const vcfMetric={
  schema:'genithm-vcf-site-qc/1',engine_version:'genithm-vcf-stream/1.0.0',
  sampling:false,genotypes_inspected:false,record_count:1,sample_count:0,contigs_seen:1,
  snv_sites:1,mnv_sites:0,indel_sites:0,complex_sites:0,symbolic_sites:0,
  reference_only_sites:0,multiallelic_sites:0,canonical_snv_alt_alleles:1,
  transitions:1,transversions:0,pass_sites:1,failed_filter_sites:0,unfiltered_sites:0,
  quality_available_sites:1,missing_quality_sites:0,mean_qual:30,expanded_bytes:140};
 for(const version of ['genithm-file-registry/2','genithm-file-registry/3']){
  const x=envelope();x.report.scientific_scope='full_vcf_site_qc';
  x.report.metrics=vcfMetric;x.report.intake.inspection='complete_vcf';
  x.report.intake.registry_version=version;
  x.report.intake.name_hint={format_id:'vcf'};
  const accepted=parseVerifiedResearchFile(x,id,project);
  assert.equal(accepted.vcf_site_qc.snv_sites,1);
  assert.equal(accepted.gff3_feature_qc,undefined);
 }
});
test('V67 GUI and chat policy show only actual GFF3 feature QC and caveats',()=>{
 const data=readFileSync(new URL('../app/dashboard/data/large-data-panel.tsx',import.meta.url),'utf8');
 const browser=readFileSync(new URL('../app/dashboard/data/universal-file-panel.tsx',import.meta.url),'utf8');
 const policy=readFileSync(new URL('../lib/genithm-ai-chat.ts',import.meta.url),'utf8');
 assert.match(data,/Whole-file GFF3 annotation QC/);
 assert.match(data,/Download GFF3 feature-QC table/);
 assert.match(browser,/Complete GFF3 annotation QC/);
 assert.match(policy,/Overlapping feature spans are not unique nucleotide coverage/);
 assert.match(policy,/GFF3 IDs, contig names, coordinates, sequence and private attributes are not supplied/);
});
