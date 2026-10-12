#!/usr/bin/env node
/**
 * Offline verification of a downloaded V15 study's deterministic payload hashes.
 * Verifies internal consistency only; does not authenticate server DB signatures.
 *
 * node --experimental-strip-types scripts/verify-pipeline-study.mjs study.json
 */
import {readFile,stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {canonicalDossierJson} from "../lib/research-dossier.ts";
import {validateStudySelection} from "../lib/pipeline-study.ts";

function digest(x){return createHash("sha256").update(canonicalDossierJson(x),"utf8").digest("hex");}
function check(bundle){
  if(bundle?.schema_version!=="genithm-pipeline-study-bundle/1"||
    bundle?.payload?.schema_version!=="genithm-pipeline-study/1"||
    !Array.isArray(bundle.payload.pipelines)||
    !Array.isArray(bundle.payload.sealed_dossier?.reports)||
    bundle?.integrity?.scope!=="payload"||
    bundle.integrity.algorithm!=="SHA-256")throw Error("Unsupported V15 study file.");
  const p=bundle.payload;
  validateStudySelection(p.project_id,p.pipelines.map(r=>r.pipeline_id));
  if(p.sealed_dossier.project_id!==p.project_id||
    p.sealed_dossier.schema_version!=="genithm-research-dossier/1"||
    p.sealed_dossier.reports.length!==p.pipelines.length)throw Error("Study dossier mismatch.");
  const byReport=new Map(p.sealed_dossier.reports.map(r=>[r.report_id,r]));
  const sha=/^[a-f0-9]{64}$/;
  for(const record of p.pipelines){
    const report=byReport.get(record.sealed_report_id);
    if(!report||record.template!=="ncbi_protein_profile_v1"||
      report.source_type!=="scientific_job"||
      report.source_id!==record.scientific_job_id||
      record.sealed_report_sha256!==report.report_sha256||
      !sha.test(record.sequence_sha256)||
      !sha.test(record.scientific_result_sha256)||
      !sha.test(record.sealed_report_sha256)||
      report.snapshot?.project?.id!==p.project_id||
      report.snapshot?.source?.resource_id!==record.scientific_job_id)
      throw Error("Pipeline-to-report identity or recorded hash mismatch.");
  }
  const studyDigest=digest(p);
  const dossierDigest=digest(p.sealed_dossier);
  if(studyDigest!==bundle.integrity.canonical_payload_sha256||
     dossierDigest!==bundle.integrity.sealed_dossier_sha256)
    throw Error("Checksum mismatch: downloaded scientific study data has changed.");
  return {studyDigest,dossierDigest,count:p.pipelines.length};
}
try{
  if(process.argv.length!==3)throw Error("Usage: verify-pipeline-study.mjs <study.json>");
  const path=process.argv[2];
  const info=await stat(path);
  if(!info.isFile()||info.size<20||info.size>3*1024*1024)
    throw Error("Study file is empty, invalid or too large.");
  const output=check(JSON.parse(await readFile(path,"utf8")));
  process.stdout.write("Study payload SHA-256 OK: "+output.studyDigest+"\n");
  process.stdout.write("Dossier payload SHA-256 OK: "+output.dossierDigest+"\n");
  process.stdout.write("Verified internal consistency for "+output.count+" recorded pipelines.\n");
  process.stdout.write("This does not independently authenticate NCBI, Supabase database seals or biological claims.\n");
}catch(error){
  process.stderr.write("Study verification failed: "+(error instanceof Error?error.message:"unknown")+"\n");
  process.exitCode=1;
}
