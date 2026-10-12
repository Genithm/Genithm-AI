import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { reconcilePipeline } from "../lib/research-pipeline.ts";

const P="10000000-0000-4000-8000-000000000001";
const O="10000000-0000-4000-8000-000000000002";
const U="10000000-0000-4000-8000-000000000003";
const R="10000000-0000-4000-8000-000000000004";
const S="10000000-0000-4000-8000-000000000005";
const J="10000000-0000-4000-8000-000000000006";
const W="10000000-0000-4000-8000-000000000007";
const HASH="a".repeat(64);
const RES="b".repeat(64);
const DATE="2026-10-12T14:00:00Z";
const mig=readFileSync(
  new URL("../../../supabase/migrations/20261012204500_autonomous_research_protein_pipeline_v1.sql",import.meta.url),"utf8",
);
function run(rest={}){return {
  id:W,project_id:P,organization_id:O,requested_by:U,template:"ncbi_protein_profile_v1",
  requested_accession:"NP_000537.3",retrieval_id:R,sequence_upload_id:S,sequence_sha256:HASH,
  scientific_job_id:J,status:"completed",failure_stage:null,failure_code:null,
  created_at:DATE,updated_at:DATE,finished_at:DATE,...rest,
};}
function source(rest={}){return {
  id:R,organization_id:O,project_id:P,requested_by:U,status:"retrieved",
  requested_accession:"NP_000537.3",source_database:"protein",
  sequence_upload_id:S,resolved_accession:"NP_000537.3",...rest,
};}
function sequence(rest={}){return {
  id:S,organization_id:O,project_id:P,created_by:U,status:"ready",
  sequence_count:1,sequence_type:"protein",sha256:HASH,...rest,
};}
function science(rest={}){return {
  id:J,organization_id:O,project_id:P,requested_by:U,status:"completed",
  job_type:"protein_properties",result_sha256:RES,...rest,
};}
describe("V14 approved protein research state machine and scientific provenance",()=>{
  it("proves a completed chain from exact RLS-verified identities and input checksum",()=>{
    const d=reconcilePipeline(run(),source(),sequence(),science());
    assert.equal(d.displayStatus,"complete");
    assert.equal(d.integrity,"recorded_consistent");
    assert.equal(d.findings.length,0);
    assert.equal(d.stages[2].href,"/dashboard/scientific-jobs/"+J);
    assert.equal(d.canRefresh,false);
  });
  it("never marks false database completion scientifically consistent",()=>{
    for(const value of [science({status:"error"}),science({result_sha256:null}),science({job_type:"pairwise_alignment"}),
      science({requested_by:W}),null]){
      const d=reconcilePipeline(run(),source(),sequence(),value);
      assert.equal(d.displayStatus,"review");
      assert.equal(d.integrity,"mismatch");
    }
  });
  it("detects forged project, organization or owner records from any stage",()=>{
    for(const mutation of [{project_id:W},{organization_id:W},{requested_by:W},
      {requested_accession:"OTHER"},{source_database:"nucleotide"}]){
      assert.equal(reconcilePipeline(run(),source(mutation),sequence(),science()).displayStatus,"review");
    }
    for(const mutation of [{id:W},{project_id:W},{organization_id:W},{created_by:W}]){
      assert.equal(reconcilePipeline(run(),source(),sequence(mutation),science()).displayStatus,"review");
    }
    for(const mutation of [{id:W},{project_id:W},{organization_id:W},{requested_by:W}]){
      assert.equal(reconcilePipeline(run(),source(),sequence(),science(mutation)).displayStatus,"review");
    }
  });
  it("validates exact recorded sequence hash, including wrong and missing SHA-256",()=>{
    for(const hash of ["bad","b".repeat(64),null]){
      assert.equal(reconcilePipeline(run(),source(),sequence({sha256:hash}),science()).displayStatus,"review");
    }
  });
  it("distinguishes a pending source from completed downstream jobs",()=>{
    const d=reconcilePipeline(
      run({status:"awaiting_source",sequence_upload_id:null,sequence_sha256:null,scientific_job_id:null,finished_at:null}),
      source({status:"retrieving",sequence_upload_id:null}),null,null);
    assert.equal(d.displayStatus,"waiting");
    assert.equal(d.canRefresh,true);
    assert.deepEqual(d.stages.map(s=>s.status),["retrieving","pending","pending"]);
  });
  it("recognizes waiting for validation with correctly attached provenance",()=>{
    const d=reconcilePipeline(run({
      status:"awaiting_validation",sequence_sha256:null,scientific_job_id:null,finished_at:null,
    }),source(),sequence({status:"validating",sha256:null}),null);
    assert.equal(d.displayStatus,"waiting");
    assert.equal(d.findings.length,0);
  });
  it("detects orphan scientific job, missing input digest and terminal timestamp races",()=>{
    assert.equal(reconcilePipeline(run({status:"running",sequence_sha256:null,finished_at:null}),
      source(),sequence(),science({status:"running"})).displayStatus,"review");
    assert.equal(reconcilePipeline(run({status:"running",finished_at:DATE}),
      source(),sequence(),science()).displayStatus,"review");
    assert.equal(reconcilePipeline(run({status:"unsupported"}),source(),sequence(),science()).displayStatus,"review");
  });
  it("supports terminal errors without claiming the last stage succeeded",()=>{
    const d=reconcilePipeline(run({status:"error",scientific_job_id:null,
      sequence_upload_id:null,sequence_sha256:null,finished_at:DATE}),source({status:"rejected"}),null,null);
    assert.equal(d.displayStatus,"failed");
    assert.equal(d.canRefresh,false);
    assert.equal(d.integrity,"pending");
  });
  it("does not accept arbitrary workflow templates or forged pipeline UUIDs",()=>{
    assert.throws(()=>reconcilePipeline(run({template:"run_any_command"}),null,null,null));
    assert.throws(()=>reconcilePipeline(run({id:"../../../admin"}),null,null,null));
  });
});
describe("V14 migration safety and concurrency contract",()=>{
  it("requires user intent, actor authorization and fixed template",()=>{
    assert.match(mig,/auth\.uid\(\)/);
    assert.match(mig,/app_private\.can_write_org\(org\)/);
    assert.match(mig,/template = 'ncbi_protein_profile_v1'/);
    assert.match(mig,/source\.requested_by<>actor/);
    assert.match(mig,/source\.source_database<>'protein'/);
  });
  it("exposes only owner-scoped read access to stored pipeline evidence",()=>{
    assert.match(mig,/enable row level security/);
    assert.match(mig,/force row level security/);
    assert.match(mig,/for select to authenticated/);
    assert.match(mig,/auth\.uid\(\)\)=requested_by/);
    assert.match(mig,/grant select on public\.research_pipeline_runs to authenticated/);
    assert.doesNotMatch(mig,/grant (insert|update|delete|all) on public\.research_pipeline_runs to authenticated/i);
  });
  it("requires unique source and scientific job IDs to reject duplicate dispatches",()=>{
    assert.match(mig,/retrieval_id uuid not null unique/);
    assert.match(mig,/scientific_job_id uuid unique/);
    assert.match(mig,/from public\.research_pipeline_runs where id=p_run_id for update/);
    assert.match(mig,/where id=run\.id and status='awaiting_validation'/);
  });
  it("listens to authoritative source validation and scientific status transitions",()=>{
    assert.match(mig,/after update of status on public\.sequence_retrievals/);
    assert.match(mig,/after update of status on public\.sequence_uploads/);
    assert.match(mig,/after update of status on public\.scientific_jobs/);
    assert.match(mig,/new\.status is not distinct from old\.status/);
  });
  it("does not dispatch from forged data or directly enqueue arbitrary worker tasks",()=>{
    assert.match(mig,/app_private\.request_protein_properties\(run\.project_id,seq\.id\)/);
    assert.match(mig,/created_by=run\.requested_by/);
    assert.match(mig,/input_sha256=seq\.sha256/);
    assert.match(mig,/seq\.sequence_type<>'protein'/);
    assert.doesNotMatch(mig,/pgmq\.send\s*\(/i);
  });
  it("restores all temporary actor claims and limits automated failure loops",()=>{
    assert.match(mig,/original_sub := current_setting/);
    assert.match(mig,/original_role := current_setting/);
    assert.ok((mig.match(/set_config\('request\.jwt\.claim\.sub',coalesce\(original_sub,''\),true\)/g)??[]).length>=2);
    assert.match(mig,/failure_code='dispatch_rejected'/);
    assert.doesNotMatch(mig,/\b(retry|requeue)_research_pipeline\b/i);
  });
});
