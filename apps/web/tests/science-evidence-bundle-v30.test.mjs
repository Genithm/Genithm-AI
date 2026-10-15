import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCIENCE_BUNDLE_VERSION,
  BUNDLE_LIMITATION,
  canonicalScienceJson,
  createScienceEvidenceBundle,
  verifyScienceEvidenceBundle,
} from "../lib/science-evidence-bundle.ts";
import { buildConversationDossier } from "../lib/conversation-research-dossier.ts";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const h = "a".repeat(64);
const sha256 = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(digest).toString("hex");
};

function fixture() {
  return buildConversationDossier({
    conversationId:a,
    plans:[{id:a,status:"dispatched",action_type:"sequence_insights",
      dispatched_resource_type:"scientific_job",dispatched_resource_id:b}],
    scientificJobs:[{id:b,status:"completed",job_type:"sequence_insights",
      result_sha256:h,result_object_path:"INTERNAL_STORAGE_KEY_SHOULD_NOT_EXPORT",
      result_summary:{
        operation:"orf_scan",orf_count:2,raw_sequence:"PRIVATE_FASTA_ATGTTTTAA",
        private_api_key:"DO_NOT_EXPORT_UNREVIEWED_JSON",
      }}],
  });
}
test("V30 portable package fingerprints metadata without claiming scientific authenticity", async () => {
  const original=fixture();
  const result=await createScienceEvidenceBundle(original,new Date("2026-10-15T20:00:00.000Z"));
  assert.equal(result.format,SCIENCE_BUNDLE_VERSION);
  assert.equal(result.payload.exported_at,"2026-10-15T20:00:00.000Z");
  assert.equal(result.payload.limitation,BUNDLE_LIMITATION);
  assert.equal(result.integrity.algorithm,"SHA-256");
  assert.match(result.integrity.payload_sha256,/^[a-f0-9]{64}$/);
  assert.equal(result.integrity.payload_sha256,await sha256(canonicalScienceJson(result.payload)));
  assert.equal(result.payload.dossier.counts.completed,1);
  assert.equal(result.payload.dossier.findings[0].result_sha256,h);
  assert.equal(result.payload.dossier.findings[0].verified_download,
    "/dashboard/scientific-jobs/"+b+"/download");
  assert.ok((await verifyScienceEvidenceBundle(result)).valid);
  const copy=JSON.parse(JSON.stringify(result));
  assert.ok((await verifyScienceEvidenceBundle(copy)).valid);
  const exported=JSON.stringify(copy);
  for(const secret of ["PRIVATE_FASTA_ATGTTTTAA","DO_NOT_EXPORT_UNREVIEWED_JSON","INTERNAL_STORAGE_KEY_SHOULD_NOT_EXPORT"]){
    assert.doesNotMatch(exported,new RegExp(secret));
  }
  assert.match(exported,/not a signature/);
  assert.match(exported,/artifact bytes/);
  assert.match(exported,/experimental validation/);
});

test("V30 canonical bytes are stable across key reorder and include unicode safely",() => {
  const lhs={z:{b:["α","⚗️"],a:"x"},a:2};
  const rhs={a:2,z:{a:"x",b:["α","⚗️"]}};
  assert.equal(canonicalScienceJson(lhs),canonicalScienceJson(rhs));
  assert.equal(canonicalScienceJson(null),"null");
  assert.throws(()=>canonicalScienceJson(Infinity),TypeError);
  assert.throws(()=>canonicalScienceJson(undefined),TypeError);
});

test("V30 fails closed on tampering of fingerprint, findings, counts, version or disclaimers",async () => {
  const bundle=await createScienceEvidenceBundle(fixture());
  for(const change of [
    (x)=>{x.integrity.payload_sha256="0".repeat(64)},
    (x)=>{x.payload.dossier.findings[0].metrics[0].value="9999"},
    (x)=>{x.payload.dossier.counts.completed=0},
    (x)=>{x.payload.dossier.findings[0].result_sha256="0".repeat(64)},
    (x)=>{x.payload.dossier.findings[0].verified_download="https://evil.invalid/out"},
    (x)=>{x.payload.dossier.version="malformed"},
    (x)=>{x.format="science-evidence-bundle/unsafe"},
    (x)=>{x.payload.limitation="Scientifically verified."},
    (x)=>{x.payload.exported_at="2026-10-15; DROP TABLE"},
    (x)=>{x.integrity.algorithm="MD5"},
    (x)=>{x.payload.dossier.findings[0].metrics.push({label:"raw_sequence",value:"ATGTTAA"})},
    (x)=>{x.payload.dossier.findings[0].extra_storage_key="secret"},
    (x)=>{x.payload.dossier.extra_user_data={api_key:"secret"}},
    (x)=>{x.payload.secret="secret"},
    (x)=>{x.unreviewed="injection"},
  ]) {
    const copy=structuredClone(bundle);
    change(copy);
    assert.equal((await verifyScienceEvidenceBundle(copy)).valid,false,JSON.stringify(change));
  }
});

test("V30 forged rehash cannot bypass metadata schema or fake recorded job state",async()=>{
  const bundle=await createScienceEvidenceBundle(fixture());
  const invalid=structuredClone(bundle);
  invalid.payload.dossier.findings[0].state="running";
  invalid.payload.dossier.findings[0].result_sha256=h;
  invalid.integrity.payload_sha256=await sha256(canonicalScienceJson(invalid.payload));
  assert.equal((await verifyScienceEvidenceBundle(invalid)).valid,false);

  const extra=structuredClone(bundle);
  extra.payload.dossier.findings[0].metrics[0].secret_token="private";
  extra.integrity.payload_sha256=await sha256(canonicalScienceJson(extra.payload));
  assert.equal((await verifyScienceEvidenceBundle(extra)).valid,false);
});

test("V30 incomplete and empty research cannot be exported as fabricated results",async()=>{
  const pending=buildConversationDossier({conversationId:a,plans:[{
    id:b,status:"ready",action_type:"protein_properties",
  }]});
  const bundle=await createScienceEvidenceBundle(pending);
  assert.equal(bundle.payload.dossier.status,"awaiting_approval");
  assert.equal(bundle.payload.dossier.counts.completed,0);
  assert.equal(bundle.payload.dossier.findings[0].result_sha256,null);
  assert.equal(bundle.payload.dossier.findings[0].verified_download,null);
  assert.equal((await verifyScienceEvidenceBundle(bundle)).valid,true);
  const empty=buildConversationDossier({conversationId:a,plans:[]});
  assert.equal((await verifyScienceEvidenceBundle(await createScienceEvidenceBundle(empty))).valid,true);
});

test("V30 refuses unexpected live rows and invalid dossier identity",async()=>{
  const valid=fixture();
  assert.rejects(createScienceEvidenceBundle({...valid,conversation_id:"not-a-uuid"}),TypeError);
  assert.rejects(createScienceEvidenceBundle({...valid,counts:{...valid.counts,total:123}}),TypeError);
  assert.rejects(createScienceEvidenceBundle({...valid,caveats:["bad\nsecret"]}),TypeError);
  assert.rejects(createScienceEvidenceBundle({...valid,findings:[{
    ...valid.findings[0], metrics:[{label:"private_api_key",value:"secret"}]
  }]}),TypeError);
  assert.rejects(createScienceEvidenceBundle(valid,new Date("broken")),TypeError);
});

test("V30 offline CLI verifies a bounded export and optional separately recorded digest",async()=>{
  const cli=fileURLToPath(new URL("../../../scripts/verify_science_evidence_bundle.mjs",import.meta.url));
  const dir=mkdtempSync(join(tmpdir(),"genithm-science-v30-"));
  try {
    const bundle=await createScienceEvidenceBundle(fixture());
    const filename=join(dir,"dossier.json");
    writeFileSync(filename,JSON.stringify(bundle,null,2));
    function verify(...extra){
      return spawnSync(process.execPath,["--experimental-strip-types",cli,filename,...extra],{
        encoding:"utf8",timeout:10_000,
      });
    }
    const passed=verify(bundle.integrity.payload_sha256);
    assert.equal(passed.status,0,passed.stderr);
    assert.match(passed.stdout,/PASS/);
    assert.match(passed.stdout,/Artifact bytes.*NOT/);
    assert.equal(verify("0".repeat(64)).status,1);
    const modified=structuredClone(bundle);
    modified.payload.dossier.findings[0].metrics[0].value="10";
    writeFileSync(filename,JSON.stringify(modified));
    assert.equal(verify().status,1);
  }finally {rmSync(dir,{recursive:true,force:true});}
});

test("V30 UI keeps existing plain JSON/Markdown while adding digest-bounded export",() => {
  const ui=readFileSync(new URL("../components/conversation-dossier-panel.tsx",import.meta.url),"utf8");
  assert.match(ui,/createScienceEvidenceBundle\(dossier\)/);
  assert.match(ui,/verifyScienceEvidenceBundle\(bundle\)/);
  assert.match(ui,/bundle\.integrity\.payload_sha256/);
  assert.match(ui,/Export SHA-256 evidence bundle/);
  assert.match(ui,/Export JSON/);
  assert.match(ui,/Export report/);
  assert.match(ui,/not verify artifact bytes/);
  assert.match(ui,/if \(!verified\.valid\) throw/);
  const ci=readFileSync(new URL("../../../.github/workflows/ci.yml",import.meta.url),"utf8");
  assert.match(ci,/science-evidence-bundle-v30\.test\.mjs/);
});
