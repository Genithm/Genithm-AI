import assert from "node:assert/strict";
import { describe,it } from "node:test";
import {
  assemblePipelineStudy, renderPipelineStudyMarkdown,
  validateStudySelection, StudyValidationError,
} from "../lib/pipeline-study.ts";
import { canonicalDossierJson } from "../lib/research-dossier.ts";

const P="10000000-0000-4000-8000-000000000001";
const ORG="10000000-0000-4000-8000-000000000002";
const OWNER="10000000-0000-4000-8000-000000000003";
const OTHER="10000000-0000-4000-8000-000000000004";
const SHA_A="a".repeat(64);
const SHA_B="b".repeat(64);
const SHA_C="c".repeat(64);
const IDS=[
  {run:"10000000-0000-4000-8000-000000000005",
   src:"10000000-0000-4000-8000-000000000006",
   seq:"10000000-0000-4000-8000-000000000007",
   job:"10000000-0000-4000-8000-000000000008",
   report:"10000000-0000-4000-8000-000000000009",accession:"NP_000537.3"},
  {run:"10000000-0000-4000-8000-000000000010",
   src:"10000000-0000-4000-8000-000000000011",
   seq:"10000000-0000-4000-8000-000000000012",
   job:"10000000-0000-4000-8000-000000000013",
   report:"10000000-0000-4000-8000-000000000014",accession:"NP_001005484.1"},
];
const time="2026-10-12T12:00:00Z";
function evidence(index){
  const ids=IDS[index];const sequenceSha=index===0?SHA_A:SHA_B;
  return {
    run:{
      id:ids.run,project_id:P,organization_id:ORG,requested_by:OWNER,
      requested_accession:ids.accession,template:"ncbi_protein_profile_v1",
      retrieval_id:ids.src,sequence_upload_id:ids.seq,sequence_sha256:sequenceSha,
      scientific_job_id:ids.job,status:"completed",failure_stage:null,failure_code:null,
      created_at:time,updated_at:time,finished_at:time,
    },
    source:{
      id:ids.src,organization_id:ORG,project_id:P,requested_by:OWNER,status:"retrieved",
      requested_accession:ids.accession,source_database:"protein",
      sequence_upload_id:ids.seq,resolved_accession:ids.accession,
    },
    sequence:{
      id:ids.seq,organization_id:ORG,project_id:P,created_by:OWNER,status:"ready",
      sequence_count:1,sequence_type:"protein",sha256:sequenceSha,
    },
    science:{
      id:ids.job,organization_id:ORG,project_id:P,requested_by:OWNER,
      status:"completed",job_type:"protein_properties",result_sha256:SHA_C,
    },
    inputs:[{job_id:ids.job,project_id:P,sequence_upload_id:ids.seq,input_position:1,input_sha256:sequenceSha}],
    report:{
      id:ids.report,project_id:P,source_resource_type:"scientific_job",
      source_resource_id:ids.job,source_job_type:"protein_properties",
      report_schema_version:"scientific-report-v2",report_sha256:sequenceSha,
      source_evidence_sha256:sequenceSha,source_result_sha256:SHA_C,
      generated_at:time,integrity_valid:true,
      report_snapshot:{
        schema_version:"scientific-report-v2",
        project:{id:P,name:"Study"},
        source:{resource_type:"scientific_job",resource_id:ids.job,status:"completed"},
        result_summary:{length:index?301:393,molecular_weight_da:index?33401:43215,
          estimated_isoelectric_point:index?6.8:7.2},
        parameters:{method:"approved"},provenance:{tool:"protein_properties"},
      },
    },
  };
}
const fixtures=()=>[evidence(0),evidence(1)];
const selected=[IDS[0].run,IDS[1].run];
const build=(rows=fixtures(),ids=selected,project=P)=>assemblePipelineStudy(project,ids,rows);
describe("Science V15 study proof and research integrity",()=>{
  it("accepts exactly 2–8 distinct valid pipelines",()=>{
    assert.deepEqual(validateStudySelection(P,selected).runIds,selected);
    for(const ids of [[],[selected[0]],[selected[0],selected[0]],[selected[0],"../other"],
      Array.from({length:9},(_,i)=>"10000000-0000-4000-8000-"+String(20+i).padStart(12,"0"))])
      assert.throws(()=>validateStudySelection(P,ids),StudyValidationError);
    assert.throws(()=>validateStudySelection("../cross-tenant",selected),StudyValidationError);
  });
  it("builds deterministic provenance plus full sealed reports with authentic input edges",async()=>{
    const study=await build();
    assert.equal(study.study_count,2);
    assert.deepEqual(study.payload.pipelines.map(p=>p.pipeline_id),selected);
    assert.equal(study.payload.pipelines[0].scientific_job_id,IDS[0].job);
    assert.equal(study.payload.sealed_dossier.reports.length,2);
    assert.equal(study.payload.pipelines[1].sealed_report_sha256,SHA_B);
    assert.match(study.payload_sha256,/^[0-9a-f]{64}$/);
  });
  it("is independent of caller selection order, report query order and object key order",async()=>{
    const a=await build(fixtures());
    const b=await build(fixtures().reverse(),selected.slice().reverse());
    assert.equal(a.payload_sha256,b.payload_sha256);
    assert.deepEqual(a.payload,b.payload);
    const sha=await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(canonicalDossierJson(a.payload)));
    const hex=Array.from(new Uint8Array(sha),n=>n.toString(16).padStart(2,"0")).join("");
    assert.equal(a.payload_sha256,hex);
  });
  it("rejects cross-project, cross-owner and cross-organization forged runs",async()=>{
    for(const [field,value] of [["project_id",OTHER],["requested_by",OTHER],["organization_id",OTHER]]){
      const rows=fixtures();rows[1].run[field]=value;
      await assert.rejects(build(rows),StudyValidationError);
    }
  });
  it("rejects uncompleted stages and missing source or science evidence",async()=>{
    for(const field of ["source","sequence","science","report"]){
      const rows=fixtures();rows[0][field]=null;
      await assert.rejects(build(rows),StudyValidationError);
    }
    const rows=fixtures();rows[1].run.status="running";
    await assert.rejects(build(rows),StudyValidationError);
  });
  it("rejects a missing scientific_job_inputs proof even with matching V14 metadata",async()=>{
    for(const invalid of [[],[{...evidence(0).inputs[0],input_sha256:SHA_B}],
      [{...evidence(0).inputs[0],sequence_upload_id:OTHER}],
      [{...evidence(0).inputs[0],project_id:OTHER}],
      [{...evidence(0).inputs[0],input_position:2}],
      [evidence(0).inputs[0],evidence(0).inputs[0]]]){
      const rows=fixtures();rows[0].inputs=invalid;
      await assert.rejects(build(rows),/Scientific job input/);
    }
  });
  it("rejects forged, missing, mismatched and unsealed reports",async()=>{
    for(const change of [
      {integrity_valid:false},{source_resource_id:OTHER},{source_resource_type:"blast_job"},
      {source_job_type:"pairwise_alignment"},{source_result_sha256:SHA_B},
      {report_sha256:"not-a-digest"},{project_id:OTHER},
    ]){
      const rows=fixtures();Object.assign(rows[0].report,change);
      await assert.rejects(build(rows),StudyValidationError);
    }
  });
  it("rejects embedded snapshot source mismatch even when report seal flag is true",async()=>{
    const rows=fixtures();rows[0].report.report_snapshot.source.resource_id=OTHER;
    await assert.rejects(build(rows),/Report snapshot identity/);
  });
  it("rejects duplicate, unexpected and missing pipeline evidence",async()=>{
    await assert.rejects(build([fixtures()[0]]),StudyValidationError);
    const duplicated=fixtures();duplicated[1].run.id=IDS[0].run;
    await assert.rejects(build(duplicated),StudyValidationError);
    const wrong=fixtures();wrong[1].run.id=OTHER;
    await assert.rejects(build(wrong),StudyValidationError);
  });
  it("rejects reuse of a sealed report across different scientific jobs",async()=>{
    const rows=fixtures();rows[1].report.id=rows[0].report.id;
    await assert.rejects(build(rows),StudyValidationError);
  });
  it("rejects oversized snapshots instead of silently trimming scientific inputs",async()=>{
    const rows=fixtures();rows[1].report.report_snapshot.parameters.payload="A".repeat(513000);
    await assert.rejects(build(rows),/too large/);
  });
  it("compares only original numeric metrics and keeps missing values distinct",async()=>{
    const rows=fixtures();delete rows[1].report.report_snapshot.result_summary.estimated_isoelectric_point;
    const study=await build(rows);
    assert.deepEqual(study.dossier.comparison.find(x=>x.key==="length").values,[393,301]);
    assert.deepEqual(study.dossier.comparison.find(x=>x.key==="estimated_isoelectric_point").values,[7.2,null]);
    assert.equal(study.dossier.comparison.some(x=>x.key==="biological_equivalence"),false);
  });
  it("Markdown provenance records every dependency and scientific cautions",async()=>{
    const study=await build();
    const markdown=renderPipelineStudyMarkdown(study,"Lab | Project\nName");
    assert.match(markdown,/Lab   Project Name/);
    assert.match(markdown,new RegExp(IDS[0].src));
    assert.match(markdown,new RegExp(IDS[1].job));
    assert.match(markdown,new RegExp(study.payload_sha256));
    assert.match(markdown,/not a digital signature/);
    assert.doesNotMatch(markdown,/significant biological discovery/i);
  });
});
