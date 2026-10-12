import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconcileWorkflow } from "../lib/workflow-reconciliation.ts";

const W = "10000000-0000-4000-8000-000000000010";
const ORG = "10000000-0000-4000-8000-000000000011";
const PROJECT = "10000000-0000-4000-8000-000000000012";
const OWNER = "10000000-0000-4000-8000-000000000013";
const CONVERSATION = "10000000-0000-4000-8000-000000000014";
const MSA = "10000000-0000-4000-8000-000000000015";
const TREE = "10000000-0000-4000-8000-000000000016";
const SHA = "a".repeat(64);
const NOW = Date.parse("2026-10-12T12:00:00.000Z");

const workflow = (overrides = {}) => ({
  id: W, organization_id: ORG, project_id: PROJECT, requested_by: OWNER,
  conversation_id: CONVERSATION, workflow_type: "msa_phylogeny",
  status: "running", msa_job_id: MSA, phylogeny_job_id: null,
  created_at: "2026-10-12T11:59:00Z", updated_at: "2026-10-12T11:59:00Z",
  finished_at: null, ...overrides,
});
const msa = (overrides = {}) => ({
  id: MSA, organization_id: ORG, project_id: PROJECT, requested_by: OWNER,
  job_type: "multiple_sequence_alignment", status: "queued",
  created_at: "2026-10-12T11:59:00Z", updated_at: "2026-10-12T11:59:00Z",
  processing_started_at: null, processing_finished_at: null,
  processing_attempts: 0, result_sha256: null, ...overrides,
});
const tree = (overrides = {}) => ({
  ...msa(), id: TREE, job_type: "phylogenetic_tree", status: "running",
  processing_started_at: "2026-10-12T11:59:30Z", processing_attempts: 1,
  ...overrides,
});
const dependency = (overrides = {}) => ({
  job_id: TREE, dependency_job_id: MSA, organization_id: ORG,
  project_id: PROJECT, dependency_role: "source_msa",
  dependency_result_sha256: SHA, ...overrides,
});
const completedMsa = () => msa({ status: "completed", result_sha256: SHA,
  processing_started_at: "2026-10-12T11:58:00Z",
  processing_finished_at: "2026-10-12T11:59:30Z" });

describe("Science V11 read-only scientific workflow reconciliation", () => {
  it("shows a queued source with a not-yet-dispatched tree, without declaring failure", () => {
    const v = reconcileWorkflow(workflow(), msa(), null, null, NOW);
    assert.equal(v.state, "running");
    assert.equal(v.stage, "msa");
    assert.deepEqual(v.stages.map(x => x.state), ["queued", "pending"]);
    assert.equal(v.lineage, "pending");
    assert.equal(v.needsReview, false);
    assert.equal(v.refreshing, true);
  });

  it("validates the exact source MSA digest from an authorized tree dependency", () => {
    const v = reconcileWorkflow(workflow({phylogeny_job_id:TREE}),
      completedMsa(), tree(), dependency(), NOW);
    assert.equal(v.state, "running");
    assert.equal(v.stage, "phylogeny");
    assert.equal(v.lineage, "verified_metadata");
    assert.equal(v.findings.length, 0);
    assert.equal(v.stages[0].resultSha256, SHA);
    assert.equal(v.stages[1].href, "/dashboard/scientific-jobs/" + TREE);
  });

  it("never treats forged or missing hashes as trustworthy lineage", () => {
    for (const dep of [dependency({dependency_result_sha256:"b".repeat(64)}),
      dependency({dependency_job_id:W}), null]) {
      const v = reconcileWorkflow(workflow({phylogeny_job_id:TREE}),
        completedMsa(), tree(), dep, NOW);
      assert.equal(v.lineage, "mismatch");
      assert.equal(v.state, "inconsistent");
      assert.equal(v.findings.some(f => f.code === "lineage_mismatch"), true);
      assert.equal(v.refreshing, false);
    }
  });

  it("flags a missing handoff after MSA completion instead of replaying it", () => {
    const v = reconcileWorkflow(workflow(), completedMsa(), null, null, NOW);
    assert.equal(v.stage, "handoff");
    assert.equal(v.state, "inconsistent");
    assert.equal(v.findings[0].code, "handoff_missing");
    assert.match(v.findings[0].guidance, /idempotency/);
  });

  it("flags a failed prerequisite left in a running workflow", () => {
    const v = reconcileWorkflow(workflow(), msa({status:"error"}), null, null, NOW);
    assert.equal(v.state, "inconsistent");
    assert.equal(v.findings.some(f => f.code === "failed_prerequisite"), true);
  });

  it("requires both completed scientific stages and matching dependency to declare a complete workflow", () => {
    const complete = workflow({status:"completed", phylogeny_job_id:TREE,
      finished_at:"2026-10-12T11:59:59Z"});
    const good = reconcileWorkflow(complete, completedMsa(),
      tree({status:"completed",result_sha256:"b".repeat(64),
        processing_finished_at:"2026-10-12T11:59:58Z"}), dependency(), NOW);
    assert.equal(good.state, "completed");
    assert.equal(good.lineage, "verified_metadata");
    assert.equal(good.stages[1].state, "completed");
    assert.equal(good.needsReview, false);

    const forged = reconcileWorkflow(complete, completedMsa(),
      tree({status:"error"}), dependency(), NOW);
    assert.equal(forged.state, "inconsistent");
    assert.equal(forged.findings.some(f => f.code === "false_completion"), true);
  });

  it("never accepts unrelated organizations, projects, actors or scientific job types", () => {
    for (const change of [
      {organization_id:"10000000-0000-4000-8000-000000000020"},
      {project_id:"10000000-0000-4000-8000-000000000020"},
      {requested_by:"10000000-0000-4000-8000-000000000020"},
      {job_type:"pairwise_alignment"},
      {id:"10000000-0000-4000-8000-000000000020"},
    ]) {
      const v = reconcileWorkflow(workflow(), msa(change), null, null, NOW);
      assert.equal(v.needsReview, true);
      assert.equal(v.state, "inconsistent");
      assert.equal(v.stages[0].state, "unavailable");
      assert.equal(v.stages[0].resultSha256, null);
    }
  });

  it("rejects a phylogenetic job linked before MSA completion", () => {
    const v = reconcileWorkflow(workflow({phylogeny_job_id:TREE}), msa(),
      tree(), dependency(), NOW);
    assert.equal(v.state, "inconsistent");
    assert.equal(v.findings.some(f => f.code === "premature_tree"), true);
  });

  it("distinguishes a merely long-running step from definite corruption", () => {
    const long = reconcileWorkflow(workflow(),
      msa({status:"running",processing_started_at:"2026-10-12T11:40:00Z"}),
      null, null, NOW);
    assert.equal(long.needsReview, true);
    assert.equal(long.state, "running");
    assert.equal(long.findings[0].code, "long_running_step");
    assert.match(long.findings[0].guidance, /not by itself proof/);
  });

  it("does not expose internal worker exceptions, source sequences or secrets", () => {
    const object = workflow({status:"error", finished_at:"2026-10-12T11:59:59Z",
      processing_error:"PRIVATE provider key"});
    const v = reconcileWorkflow(object, msa({status:"error",processing_error:"PRIVATE raw sequence"}),
      null, null, NOW);
    const payload = JSON.stringify(v);
    assert.equal(v.state, "error");
    assert.equal(payload.includes("PRIVATE"), false);
    assert.equal(payload.includes("provider key"), false);
  });

  it("reports a broken workflow with a running scientific job after terminal status", () => {
    const v = reconcileWorkflow(workflow({status:"cancelled",finished_at:"2026-10-12T11:59:59Z"}),
      msa({status:"running"}), null, null, NOW);
    assert.equal(v.findings.some(f => f.code === "terminal_with_active_job"), true);
    assert.equal(v.needsReview, true);
  });

  it("fails closed on malformed workflow identifiers or unsupported multi-step types", () => {
    assert.throws(() => reconcileWorkflow(workflow({project_id:"../foreign"}), msa(), null, null, NOW));
    assert.throws(() => reconcileWorkflow(workflow({workflow_type:"random"}), msa(), null, null, NOW));
    assert.throws(() => reconcileWorkflow(workflow(), msa(), null, null, Number.NaN));
  });

  it("reports completion timestamp lifecycle inconsistency", () => {
    const v = reconcileWorkflow(workflow({finished_at:"2026-10-12T12:00:00Z"}),
      msa(), null, null, NOW);
    assert.equal(v.state, "inconsistent");
    assert.equal(v.findings.some(f => f.code === "running_with_finish_time"), true);
  });

  it("does not confuse recorded metadata matches with rehashing storage bytes", () => {
    const v = reconcileWorkflow(workflow({phylogeny_job_id:TREE}),
      completedMsa(), tree(), dependency(), NOW);
    assert.equal(v.lineage, "verified_metadata");
    assert.equal(Object.hasOwn(v, "storage_cryptographic_verification"), false);
    assert.equal(v.stages.length, 2);
  });
});
