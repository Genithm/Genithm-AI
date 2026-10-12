import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { reconcileResearchJourney,eligibleSequence } from "../lib/research-journey.ts";
const PROJECT="10000000-0000-4000-8000-000000000001";
const OTHER="10000000-0000-4000-8000-000000000002";
const RET="10000000-0000-4000-8000-000000000003";
const UP="10000000-0000-4000-8000-000000000004";
const JOB="10000000-0000-4000-8000-000000000005";
const REP="10000000-0000-4000-8000-000000000006";
const HASH="a".repeat(64);
const now="2026-10-12T12:00:00.000Z";
function retrieval(other={}){return {id:RET,project_id:PROJECT,status:"retrieved",source_database:"nucleotide",requested_accession:"NM_000546.6",resolved_accession:"NM_000546.6",sequence_upload_id:UP,created_at:now,source_retrieved_at:now,...other}}
function upload(other={}){return {id:UP,project_id:PROJECT,status:"ready",sequence_type:"dna",sequence_count:1,sha256:HASH,original_filename:"TP53.fasta",...other}}
function job(other={}){return {id:JOB,project_id:PROJECT,job_type:"pairwise_alignment",status:"completed",result_sha256:HASH,created_at:now,...other}}
function input(other={}){return {job_id:JOB,project_id:PROJECT,sequence_upload_id:UP,input_position:1,...other}}
function report(other={}){return {id:REP,project_id:PROJECT,source_resource_type:"scientific_job",source_resource_id:JOB,report_sha256:HASH,generated_at:now,...other}}
function get(r=[retrieval()],u=[upload()],j=[job()],i=[input()],s=[report()]){return reconcileResearchJourney(PROJECT,r,u,j,i,s)}
describe("Science V13 authenticated research journey provenance",()=>{
  it("links NCBI to scientific jobs ONLY via the recorded upload and job input",()=>{
    const [record]=get();
    assert.equal(record.state,"complete");
    assert.equal(record.linkedBy,"recorded_upload_id");
    assert.equal(record.analyses.length,1);
    assert.deepEqual(record.analyses[0].positions,[1]);
    assert.equal(record.analyses[0].reports[0].id,REP);
  });
  it("never joins unrelated analyses by project alone",()=>{
    const [record]=get([retrieval()],[upload()],[job()],[],[report()]);
    assert.equal(record.state,"ready");
    assert.equal(record.analyses.length,0);
  });
  it("does not allow a cross-project upload to supply scientific evidence",()=>{
    const [record]=get([retrieval()],[upload({project_id:OTHER})],[job()],[input()],[report()]);
    assert.equal(record.state,"integrity_review");
    assert.equal(record.upload,null);
    assert.equal(record.analyses.length,0);
  });
  it("excludes cross-project or forged scientific edges",()=>{
    for(const edge of [{project_id:OTHER},{job_id:OTHER},{sequence_upload_id:OTHER},{input_position:0}]){
      assert.equal(get([retrieval()],[upload()],[job()],[input(edge)])[0].analyses.length,0);
    }
    assert.equal(get([retrieval()],[upload()],[job({project_id:OTHER})],[input()])[0].analyses.length,0);
  });
  it("rejects unrelated or forged report links",()=>{
    assert.equal(get([retrieval()],[upload()],[job()],[input()],[report({source_resource_id:OTHER})])[0].analyses[0].reports.length,0);
    assert.equal(get([retrieval()],[upload()],[job()],[input()],[report({project_id:OTHER})])[0].analyses[0].reports.length,0);
    assert.equal(get([retrieval()],[upload()],[job()],[input()],[report({report_sha256:"forged"})])[0].analyses[0].reports.length,0);
  });
  it("marks retrieved data with unavailable sequence as integrity review",()=>{
    assert.equal(get([retrieval()],[upload({sha256:"bad"})],[],[],[])[0].state,"integrity_review");
    assert.equal(get([retrieval()],[],[],[],[])[0].state,"integrity_review");
  });
  it("tracks pending validation and NCBI outcomes without pretending analysis happened",()=>{
    assert.equal(get([retrieval()],[upload({status:"validating"})],[],[],[])[0].state,"needs_validation");
    assert.equal(get([retrieval({status:"queued",sequence_upload_id:null})],[],[],[],[])[0].state,"retrieving");
    assert.equal(get([retrieval({status:"not_found",sequence_upload_id:null})],[],[],[],[])[0].state,"not_found");
    assert.equal(get([retrieval({status:"error",sequence_upload_id:null})],[],[],[],[])[0].state,"error");
  });
  it("does not describe active science as completed",()=>{
    assert.equal(get([retrieval()],[upload()],[job({status:"running"})],[input()],[])[0].state,"analyzing");
    assert.equal(get([retrieval()],[upload()],[job({status:"queued"})],[input()],[])[0].state,"analyzing");
  });
  it("has strict compatibility rules before approved dispatch",()=>{
    assert.equal(eligibleSequence(upload(),"nucleotide"),true);
    assert.equal(eligibleSequence(upload(),"protein"),false);
    assert.equal(eligibleSequence(upload({sequence_type:"protein"}),"protein"),true);
    assert.equal(eligibleSequence(upload({sequence_count:2}),"nucleotide"),false);
    assert.equal(eligibleSequence(upload({sha256:"bad"}),"nucleotide"),false);
  });
  it("fails on untrusted project IDs rather than returning arbitrary records",()=>{
    assert.throws(()=>reconcileResearchJourney("../other",[],[],[],[],[]),/Invalid authorized project/);
    assert.equal(get([retrieval({project_id:OTHER})],[],[],[],[]).length,0);
  });
});
