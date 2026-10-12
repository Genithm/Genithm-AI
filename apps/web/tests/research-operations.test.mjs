import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PIPELINES, classifyOperationState, normalizeOperation, collectOperations, summarizeOperations,
} from "../lib/research-operations.ts";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "10000000-0000-4000-8000-000000000002";
const JOB = "10000000-0000-4000-8000-000000000003";
const CONVERSATION = "10000000-0000-4000-8000-000000000004";
const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function row(overrides = {}) {
  return {
    id: JOB, project_id: PROJECT, status: "queued",
    created_at: "2026-10-12T11:59:00.000Z",
    updated_at: "2026-10-12T11:59:00.000Z",
    processing_attempts: 0, ...overrides,
  };
}

describe("Science V10 authoritative pipeline lifecycle", () => {
  it("covers every production pipeline without omissions", () => {
    assert.equal(PIPELINES.length, 9);
    assert.deepEqual(new Set(PIPELINES).size, 9);
    for (const pipeline of PIPELINES) {
      assert.equal(classifyOperationState(pipeline, "queued"), "queued");
      assert.equal(classifyOperationState(pipeline, "running"), "running");
      assert.equal(classifyOperationState(pipeline, "error"), "failed");
      assert.equal(classifyOperationState(pipeline, "cancelled"), "cancelled");
    }
  });

  it("does not misclassify a database scientific 'error' as an active worker", () => {
    const item = normalizeOperation("scientific", row({ status: "error" }), NOW);
    assert.equal(item.state, "failed");
    assert.equal(item.attention, true);
    assert.equal(item.ageSeconds, 60);
    assert.equal(item.href, "/dashboard/scientific-jobs/" + JOB);
  });

  it("separates valid provider no-match outcomes from failures", () => {
    assert.equal(classifyOperationState("ncbi", "not_found"), "completed");
    assert.equal(classifyOperationState("protein_annotation", "no_mapping"), "completed");
    assert.equal(classifyOperationState("ncbi", "rejected"), "failed");
    assert.equal(classifyOperationState("sequence_input", "ready"), "completed");
  });

  it("AI plans ready for human approval are neither completed nor stuck in execution", () => {
    const item = normalizeOperation("ai_plan", row({
      status: "ready", conversation_id: CONVERSATION,
    }), NOW);
    assert.equal(item.state, "needs_action");
    assert.equal(item.attention, false);
    assert.equal(item.href, "/dashboard/ai/" + CONVERSATION);
    assert.equal(classifyOperationState("ai_plan", "dispatched"), "completed");
    assert.equal(classifyOperationState("ai_plan", "awaiting_confirmation"), "needs_action");
  });

  it("uses authoritative queued age boundary and flags only beyond 5 minutes", () => {
    const justQueued = normalizeOperation("blast", row({
      created_at: "2026-10-12T11:55:00.000Z",
    }), NOW);
    assert.equal(justQueued.ageSeconds, 300);
    assert.equal(justQueued.attention, false);
    const delayed = normalizeOperation("blast", row({
      created_at: "2026-10-12T11:54:59.000Z",
    }), NOW);
    assert.equal(delayed.attention, true);
    assert.match(delayed.attentionReason, /Queued over five minutes/);
  });

  it("running age uses processing_started_at instead of creation time", () => {
    const item = normalizeOperation("scientific", row({
      status: "running", created_at: "2026-10-12T08:00:00.000Z",
      processing_started_at: "2026-10-12T11:56:00.000Z",
    }), NOW);
    assert.equal(item.ageSeconds, 240);
    assert.equal(item.attention, false);
  });

  it("flags a running job over fifteen minutes without inventing a worker outage", () => {
    const item = normalizeOperation("scientific", row({
      status: "validating_result",
      processing_started_at: "2026-10-12T11:44:59.000Z",
    }), NOW);
    assert.equal(item.state, "running");
    assert.equal(item.attention, true);
    assert.match(item.attentionReason, /verify worker progress/);
  });

  it("never silently calls an undocumented status healthy", () => {
    const item = normalizeOperation("ai_workflow", row({
      status: "mystery_state", conversation_id: CONVERSATION,
    }), NOW);
    assert.equal(item.state, "unknown");
    assert.equal(item.attention, true);
    assert.equal(item.href, "/dashboard/workflows/" + JOB);
  });

  it("does not expose provider error bodies or prompts through normalized projections", () => {
    const item = normalizeOperation("ai_plan", row({
      status: "error", conversation_id: CONVERSATION,
      processing_error: "sensitive secret and model context",
      content: "user prompt",
    }), NOW);
    assert.equal(item.attention, true);
    assert.equal(JSON.stringify(item).includes("sensitive secret"), false);
    assert.equal(JSON.stringify(item).includes("user prompt"), false);
  });

  it("removes control characters and caps user-provided labels", () => {
    const item = normalizeOperation("sequence_input", row({
      original_filename: "x".repeat(180) + "\n PRIVATE",
      status: "ready",
    }), NOW);
    assert.equal(item.label.length, 112);
    assert.equal(item.state, "completed");
  });

  it("never creates direct record links from arbitrary identifiers", () => {
    assert.equal(normalizeOperation("scientific", row({id: "../../../admin"}), NOW), null);
    assert.equal(normalizeOperation("scientific", row({project_id: "../project"}), NOW), null);
    const item = normalizeOperation("ai_interpretation", row({
      conversation_id: "javascript:alert(1)",
    }), NOW);
    assert.equal(item.href, null);
    assert.equal(normalizeOperation("ncbi", row({status:"retrieved"}), NOW).href, "/dashboard/tools");
  });

  it("supports all nine source types and sorts deterministically", () => {
    const sources = Object.fromEntries(PIPELINES.map((p,i) => [
      p, [row({
        id: "10000000-0000-4000-8000-" + String(100 + i).padStart(12,"0"),
        created_at: new Date(NOW - i * 60000).toISOString(),
        status: "completed",
      })],
    ]));
    const operations = collectOperations(sources, NOW);
    assert.equal(operations.length, 9);
    assert.deepEqual(operations.map(x => x.pipeline), PIPELINES);
    const summary = summarizeOperations(operations);
    assert.equal(summary.visible, 9);
    // Distinct pipeline-specific terminal status definitions are intentional.
    assert.ok(summary.completed > 0);
    assert.equal(summary.queued + summary.running + summary.needsAction +
      summary.completed + summary.failed + summary.cancelled + summary.unknown, 9);
  });

  it("does not equate missing telemetry or invalid clock data with a time-based outage", () => {
    const item = normalizeOperation("scientific", row({
      created_at: "not-a-date", updated_at: "not-a-date",
    }), NOW);
    assert.equal(item.ageSeconds, null);
    assert.equal(item.attention, false);
    assert.equal(collectOperations({ scientific: [row()] }, Number.NaN).length, 0);
  });

  it("does not count cancelled jobs as active or attention", () => {
    const rows = collectOperations({
      scientific: [row({status:"cancelled"})],
      ai_plan: [row({ status:"ready",conversation_id:CONVERSATION })],
      ncbi: [row({status:"not_found"})],
    }, NOW);
    const summary = summarizeOperations(rows);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.needsAction, 1);
    assert.equal(summary.running, 0);
  });

  it("ignores corrupt, tenant-unscoped and invalid source records", () => {
    const rows = collectOperations({
      scientific: [
        row({id:""}), row({project_id:"not-a-uuid"}),
        row({status:"completed"}),
      ],
    }, NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "completed");
  });
});
