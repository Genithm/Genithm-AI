import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe,it} from "node:test";
import {reconcilePipeline} from "../lib/research-pipeline.ts";

const PROJECT="10000000-0000-4000-8000-000000000001";
const ORG="10000000-0000-4000-8000-000000000002";
const OWNER="10000000-0000-4000-8000-000000000003";
const RUN="10000000-0000-4000-8000-000000000004";
const SOURCE="10000000-0000-4000-8000-000000000005";
const SEQUENCE="10000000-0000-4000-8000-000000000006";
const JOB="10000000-0000-4000-8000-000000000007";
const FOREIGN="10000000-0000-4000-8000-000000000008";
const INPUT_HASH="a".repeat(64);
const RESULT_HASH="b".repeat(64);
const TIME="2026-10-12T15:00:00Z";
function run(over={}){return {id:RUN,project_id:PROJECT,organization_id:ORG,requested_by:OWNER,
  requested_accession:"NM_000546.6",template:"ncbi_nucleotide_orf_v1",
  retrieval_id:SOURCE,sequence_upload_id:SEQUENCE,sequence_sha256:INPUT_HASH,
  scientific_job_id:JOB,status:"completed",failure_stage:null,failure_code:null,
  created_at:TIME,updated_at:TIME,finished_at:TIME,...over};}
function source(over={}){return {id:SOURCE,organization_id:ORG,project_id:PROJECT,
  requested_by:OWNER,status:"retrieved",requested_accession:"NM_000546.6",
  resolved_accession:"NM_000546.6",source_database:"nucleotide",
  sequence_upload_id:SEQUENCE,...over};}
function sequence(over={}){return {id:SEQUENCE,organization_id:ORG,project_id:PROJECT,
  created_by:OWNER,status:"ready",sequence_type:"dna",
  sequence_count:1,sha256:INPUT_HASH,...over};}
function science(over={}){return {id:JOB,organization_id:ORG,project_id:PROJECT,
  requested_by:OWNER,status:"completed",job_type:"sequence_insights",
  parameters:{operation:"orf_scan",motif:null,min_aa:30},
  result_sha256:RESULT_HASH,...over};}
const sql=readFileSync(new URL("../../../supabase/migrations/20261012211000_autonomous_nucleotide_orf_pipeline_v1.sql",import.meta.url),"utf8");

describe("V16 nucleotide ORF template provenance and lifecycle",()=>{
  it("accepts a completed authorized nucleotide→FASTA→ORF path",()=>{
    const v=reconcilePipeline(run(),source(),sequence(),science());
    assert.equal(v.displayStatus,"complete");
    assert.equal(v.integrity,"recorded_consistent");
    assert.deepEqual(v.stages.map(x=>x.name),["NCBI nucleotide retrieval","FASTA validation","ORF scan (min 30 aa)"]);
    assert.equal(v.stages[2].href,"/dashboard/scientific-jobs/"+JOB);
  });
  it("permits RNA as a validated nucleotide sequence",()=>{
    assert.equal(reconcilePipeline(run(),source(),sequence({sequence_type:"rna"}),science()).displayStatus,"complete");
  });
  it("rejects protein input, multiple FASTA records or invalid SHA on nucleotide workflow",()=>{
    for(const change of [{sequence_type:"protein"},{sequence_count:2},{sha256:"corrupted"}]){
      assert.equal(reconcilePipeline(run(),source(),sequence(change),science()).displayStatus,"review");
    }
  });
  it("rejects unrelated source databases and cross-owner/project evidence",()=>{
    for(const change of [{source_database:"protein"},{requested_by:FOREIGN},
      {project_id:FOREIGN},{organization_id:FOREIGN},{requested_accession:"NM_999999.1"}]){
      assert.equal(reconcilePipeline(run(),source(change),sequence(),science()).displayStatus,"review");
    }
    assert.equal(reconcilePipeline(run(),source(),sequence({created_by:FOREIGN}),science()).displayStatus,"review");
  });
  it("rejects unrelated job types and incorrect ORF parameters",()=>{
    for(const change of [
      {job_type:"protein_properties"},{job_type:"phylogenetic_tree"},
      {parameters:{operation:"reverse_complement",motif:null,min_aa:30}},
      {parameters:{operation:"orf_scan",motif:null,min_aa:60}},
      {parameters:{operation:"orf_scan",motif:"ACG",min_aa:30}},
      {parameters:null},{parameters:{}},{requested_by:FOREIGN},
    ]){
      assert.equal(reconcilePipeline(run(),source(),sequence(),science(change)).displayStatus,"review");
    }
  });
  it("recognizes waiting and active nucleotide states without asserting completion",()=>{
    const r=run({status:"awaiting_source",sequence_upload_id:null,
      sequence_sha256:null,scientific_job_id:null,finished_at:null});
    const v=reconcilePipeline(r,source({status:"queued",sequence_upload_id:null}),null,null);
    assert.equal(v.displayStatus,"waiting");
    assert.equal(v.canRefresh,true);
    const active=reconcilePipeline(run({status:"running",finished_at:null}),
      source(),sequence(),science({status:"running",result_sha256:null}));
    assert.equal(active.displayStatus,"active");
  });
  it("preserves valid V14 protein-properties read model",()=>{
    const pRun=run({template:"ncbi_protein_profile_v1",requested_accession:"NP_000537.3"});
    const pSrc=source({requested_accession:"NP_000537.3",source_database:"protein"});
    const pSeq=sequence({sequence_type:"protein"});
    const pScience=science({job_type:"protein_properties",parameters:undefined});
    const v=reconcilePipeline(pRun,pSrc,pSeq,pScience);
    assert.equal(v.displayStatus,"complete");
    assert.equal(v.stages[0].name,"NCBI protein retrieval");
  });
  it("does not expose invalid states as completed",()=>{
    assert.equal(reconcilePipeline(run({status:"completed",finished_at:null}),
      source(),sequence(),science()).displayStatus,"review");
    assert.throws(()=>reconcilePipeline(run({template:"unapproved_custom_pipeline"}),source(),sequence(),science()));
  });
});
describe("V16 database migration safety contract",()=>{
  it("allows exactly two fixed templates with no unconstrained job dispatcher",()=>{
    assert.match(sql,/ncbi_protein_profile_v1','ncbi_nucleotide_orf_v1/);
    assert.match(sql,/app_private\.request_sequence_insights\(run\.project_id,seq\.id,'orf_scan',null,30\)/);
    assert.match(sql,/run\.template='ncbi_protein_profile_v1'/);
    assert.match(sql,/run\.template='ncbi_nucleotide_orf_v1'/);
    assert.doesNotMatch(sql,/pgmq\.send\s*\(/i);
  });
  it("uses existing row-lock and verifies scientific input against source SHA-256",()=>{
    assert.match(sql,/where id=p_run_id for update/);
    assert.match(sql,/input_position=1/);
    assert.match(sql,/i\.input_sha256=seq\.sha256/);
    assert.match(sql,/downstream\.parameters->>'operation'='orf_scan'/);
  });
  it("does not delegate user scope or allow arbitrary accession reuse",()=>{
    assert.match(sql,/actor uuid := auth\.uid\(\)/);
    assert.match(sql,/app_private\.can_write_org\(org\)/);
    assert.match(sql,/source\.requested_by<>actor/);
    assert.match(sql,/source\.source_database<>'nucleotide'/);
    assert.match(sql,/pg_advisory_xact_lock/);
  });
  it("restores actor claims on exception and normal completion",()=>{
    assert.ok((sql.match(/set_config\('request\.jwt\.claim\.sub',coalesce\(original_sub,''\),true\)/g)??[]).length>=2);
  });
  it("restricts RPC access to authenticated and no direct internal or table grants",()=>{
    assert.match(sql,/grant execute on function public\.request_research_nucleotide_pipeline\(uuid,text\)/);
    assert.match(sql,/revoke all on function public\.request_research_nucleotide_pipeline\(uuid,text\)/);
    assert.match(sql,/revoke all on function app_private\.advance_research_protein_pipeline\(uuid\)/);
    assert.doesNotMatch(sql,/grant (update|insert|delete|all) on public\.research_pipeline_runs/i);
  });
  it("preserves existing failure terminal handling and no retries",()=>{
    assert.match(sql,/failure_code='analysis_failed'/);
    assert.match(sql,/failure_code='dispatch_rejected'/);
    assert.doesNotMatch(sql,/create (or replace )?function .*retry_research/i);
  });
});
