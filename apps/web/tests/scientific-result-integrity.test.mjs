import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ScientificResultIntegrityError,
  scientificResultDescriptor,
  verifiedScientificResultBytes,
} from "../lib/scientific-result-integrity.ts";

const org = "10000000-0000-4000-8000-000000000001";
const project = "10000000-0000-4000-8000-000000000002";
const jobId = "10000000-0000-4000-8000-000000000003";
const digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function job(type, filename) {
  return {
    id: jobId,
    organization_id: org,
    project_id: project,
    job_type: type,
    status: "completed",
    result_object_path: `${org}/${project}/${jobId}/${filename}`,
    result_sha256: digest,
    result_bytes: 3,
  };
}

describe("production scientific result downloads", () => {
  for (const [kind, filename] of [
    ["pairwise_alignment", "pairwise-result.json"],
    ["multiple_sequence_alignment", "msa-result.fasta"],
    ["phylogenetic_tree", "tree-result.nwk"],
    ["sequence_insights", "sequence-insights-result.json"],
    ["protein_properties", "protein-properties.json"],
  ]) {
    it(`accepts canonical ${kind} artifact identity`, () => {
      const descriptor = scientificResultDescriptor(job(kind, filename));
      assert.equal(descriptor.objectPath, `${org}/${project}/${jobId}/${filename}`);
      assert.equal(descriptor.expectedSha256, digest);
      assert.equal(descriptor.expectedBytes, 3);
      assert.ok(descriptor.filename.endsWith("." + filename.split(".").at(-1)));
    });
  }

  it("rejects wrong project, job or filename before storage access", () => {
    const valid = job("phylogenetic_tree", "tree-result.nwk");
    for (const path of [
      `another-org/${project}/${jobId}/tree-result.nwk`,
      `${org}/another-project/${jobId}/tree-result.nwk`,
      `${org}/${project}/another-job/tree-result.nwk`,
      `${org}/${project}/${jobId}/msa-result.fasta`,
      `${org}/${project}/../${jobId}/tree-result.nwk`,
    ]) {
      assert.throws(() => scientificResultDescriptor({ ...valid, result_object_path: path }),
        ScientificResultIntegrityError);
    }
  });

  it("rejects incomplete jobs and invented artifact metadata", () => {
    const valid = job("sequence_insights", "sequence-insights-result.json");
    for (const update of [
      { status: "queued" },
      { status: "error" },
      { status: "cancelled" },
      { result_sha256: "0".repeat(64) + "extra" },
      { result_sha256: null },
      { result_bytes: 0 },
      { result_bytes: true },
      { result_bytes: 25 * 1024 * 1024 + 1 },
      { result_bytes: Number.NaN },
      { job_type: "unknown" },
    ]) {
      assert.throws(() => scientificResultDescriptor({ ...valid, ...update }),
        ScientificResultIntegrityError);
    }
  });

  it("only returns downloaded bytes when SHA-256 and byte count match", async () => {
    const verified = await verifiedScientificResultBytes(new Blob(["abc"]), 3, digest);
    assert.deepEqual(Buffer.from(verified), Buffer.from("abc"));
    await assert.rejects(
      verifiedScientificResultBytes(new Blob(["abd"]), 3, digest),
      ScientificResultIntegrityError,
    );
    await assert.rejects(
      verifiedScientificResultBytes(new Blob(["abc"]), 4, digest),
      ScientificResultIntegrityError,
    );
    await assert.rejects(
      verifiedScientificResultBytes(new Blob(["abc"]), 3, "0".repeat(64)),
      ScientificResultIntegrityError,
    );
  });
});
