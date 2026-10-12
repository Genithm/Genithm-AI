import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleDossier, canonicalDossierJson, renderDossierMarkdown,
  validateDossierSelection, DossierValidationError,
  DOSSIER_MAX_REPORTS, DOSSIER_MAX_SINGLE_REPORT_CHARS,
} from "../lib/research-dossier.ts";

const PROJECT = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const ID1 = "10000000-0000-4000-8000-000000000003";
const ID2 = "10000000-0000-4000-8000-000000000004";
const ID3 = "10000000-0000-4000-8000-000000000005";
const SRC1 = "10000000-0000-4000-8000-000000000006";
const SRC2 = "10000000-0000-4000-8000-000000000007";
const SEAL_A = "a".repeat(64);
const SEAL_B = "b".repeat(64);
const time = "2026-10-12T12:00:00.000Z";

function row(id, src, source = "scientific_job", summary = {}, rest = {}) {
  return {
    id, project_id: PROJECT, source_resource_type: source,
    source_resource_id: src,
    source_job_type: source === "scientific_job" ? "pairwise_alignment" : null,
    report_schema_version: "scientific-report-v2",
    report_sha256: id === ID1 ? SEAL_A : SEAL_B,
    source_evidence_sha256: SEAL_A,
    source_result_sha256: SEAL_B,
    generated_at: time,
    integrity_valid: true,
    report_snapshot: {
      schema_version: "scientific-report-v2",
      project: { id: PROJECT, name: "Example Project" },
      source: { resource_type: source, resource_id: src, status: "completed" },
      result_summary: summary, parameters: { mode: "exact" },
      inputs: [], dependencies: [], provenance: { tool: "validated" },
      interpretation_policy: { statement: "No AI inference in scientific truth." },
    },
    ...rest,
  };
}
const fixture = () => [
  row(ID1, SRC1, "scientific_job", { identity_percent: 90, aligned_length: 100, matches: 90 }),
  row(ID2, SRC2, "blast_job", { identity_percent: 87, aligned_length: 120, leaf_count: 3 }),
];

describe("Science V12 curated multi-report research dossier", () => {
  it("requires 2–8 different valid report IDs in an authorized project", () => {
    assert.deepEqual(validateDossierSelection(PROJECT, [ID2, ID1]).reportIds, [ID1, ID2]);
    for (const ids of [[], [ID1], [ID1, ID1],
      Array.from({length: DOSSIER_MAX_REPORTS + 1}, (_, i) =>
        "10000000-0000-4000-8000-" + String(i + 100).padStart(12, "0")),
      [ID1, "../admin"], [ID1, ""],
    ]) assert.throws(() => validateDossierSelection(PROJECT, ids), DossierValidationError);
    assert.throws(() => validateDossierSelection("../foreign", [ID1, ID2]), DossierValidationError);
  });

  it("packages two independently integrity-approved report snapshots in canonical ID order", async () => {
    const dossier = await assembleDossier(PROJECT, [ID2, ID1], fixture().reverse());
    assert.equal(dossier.report_count, 2);
    assert.deepEqual(dossier.payload.reports.map(r => r.report_id), [ID1, ID2]);
    assert.equal(dossier.payload.reports[0].report_sha256, SEAL_A);
    assert.equal(dossier.payload.reports[1].source_type, "blast_job");
    assert.match(dossier.canonical_payload_sha256, /^[a-f0-9]{64}$/);
    assert.equal(dossier.payload.reports[0].snapshot.provenance.tool, "validated");
  });

  it("produces identical package checksum regardless of user selection and RPC return order", async () => {
    const a = await assembleDossier(PROJECT, [ID1, ID2], fixture());
    const b = await assembleDossier(PROJECT, [ID2, ID1], fixture().reverse());
    assert.equal(a.canonical_payload_sha256, b.canonical_payload_sha256);
    assert.deepEqual(a.payload, b.payload);
    const canonical = canonicalDossierJson(a.payload);
    const digest = Array.from(new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
    ), x => x.toString(16).padStart(2, "0")).join("");
    assert.equal(digest, a.canonical_payload_sha256);
  });

  it("recursive canonical JSON is independent of property insertion order", () => {
    assert.equal(canonicalDossierJson({z:[{y:2,x:1}],a:true}),
      canonicalDossierJson({a:true,z:[{x:1,y:2}]}));
    assert.throws(() => canonicalDossierJson({foo:undefined}), DossierValidationError);
    assert.throws(() => canonicalDossierJson({foo:Number.NaN}), DossierValidationError);
  });

  it("rejects cross-project reports even if report RPC claims integrity valid", async () => {
    const rows = fixture();
    rows[0].project_id = OTHER;
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],rows), DossierValidationError);
  });

  it("rejects mismatched internal snapshot project and source identities", async () => {
    const wrongSource = fixture();
    wrongSource[0].report_snapshot.source.resource_id = OTHER;
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],wrongSource), DossierValidationError);
    const wrongProject = fixture();
    wrongProject[1].report_snapshot.project.id = OTHER;
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],wrongProject), DossierValidationError);
  });

  it("rejects any report whose authoritative RPC says integrity_valid=false", async () => {
    const reports = fixture();
    reports[1].integrity_valid = false;
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],reports), /seals failed/);
  });

  it("rejects forged hashes and unsupported resource types", async () => {
    const badHash = fixture();
    badHash[0].report_sha256 = "not-sha256";
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],badHash), /invalid seal/);
    const unsupported = fixture();
    unsupported[1].source_resource_type = "unverified-literature";
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],unsupported), /unsupported/);
  });

  it("rejects missing reports, duplicate returned rows and incorrectly scoped IDs", async () => {
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],[fixture()[0]]), /missing or unauthorized/);
    const bad = [fixture()[0], fixture()[0]];
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],bad), /Duplicate or malformed/);
    const wrong = fixture();
    wrong[1].id = ID3;
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],wrong), /missing or unauthorized/);
  });

  it("prevents oversized bundles rather than silently truncating sealed evidence", async () => {
    const rows = fixture();
    rows[0].report_snapshot.parameters =
      { arbitrarySequence: "A".repeat(DOSSIER_MAX_SINGLE_REPORT_CHARS) };
    await assert.rejects(assembleDossier(PROJECT,[ID1,ID2],rows), /too large/);
  });

  it("comparison only extracts recorded numerical summaries without inventing values", async () => {
    const dossier = await assembleDossier(PROJECT,[ID1,ID2],fixture());
    const score = dossier.comparison.find(r => r.key === "identity_percent");
    assert.deepEqual(score.values, [90,87]);
    assert.equal(score.unit, "%");
    const leaves = dossier.comparison.find(r => r.key === "leaf_count");
    assert.deepEqual(leaves.values, [null,3]);
    assert.equal(dossier.comparison.some(r => r.key === "p_value"), false);
  });

  it("does not interpolate nonnumeric, NaN or unbounded summary metrics", async () => {
    const rows = fixture();
    rows[0].report_snapshot.result_summary.identity_percent = "unknown";
    rows[0].report_snapshot.result_summary.matches = 1e15;
    const dossier = await assembleDossier(PROJECT,[ID1,ID2],rows);
    assert.deepEqual(dossier.comparison.find(x => x.key === "identity_percent").values,
      [null,87]);
    assert.equal(dossier.comparison.some(x => x.key === "matches"), false);
  });

  it("Markdown includes integrity scope, all source seals and missing metric caveats", async () => {
    const dossier = await assembleDossier(PROJECT,[ID1,ID2],fixture());
    const markdown = renderDossierMarkdown(dossier, "Lab | Multi\nStudy");
    assert.match(markdown, /Lab   Multi Study/);
    assert.match(markdown, new RegExp(dossier.canonical_payload_sha256));
    assert.match(markdown, new RegExp(SEAL_A));
    assert.match(markdown, /Blank cells indicate unavailable metrics/);
    assert.match(markdown, /not a signature/);
    assert.doesNotMatch(markdown, /generated discovery/i);
  });

  it("does not confuse a dossier checksum with verification of scientific truth", async () => {
    const dossier = await assembleDossier(PROJECT,[ID1,ID2],fixture());
    assert.equal(Object.hasOwn(dossier, "scientific_validity"), false);
    assert.equal(dossier.report_count, 2);
  });
});
