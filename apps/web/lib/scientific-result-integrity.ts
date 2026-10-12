/**
 * Production result-download trust boundary.
 *
 * Supabase RLS restricts who can read a scientific job. A completed job's
 * recorded metadata alone does not prove downloaded storage bytes are intact.
 * Verify size + SHA-256 before returning those bytes to the browser.
 */
const MAX_SCIENTIFIC_RESULT_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

const RESULT_FORMATS: Record<string, { objectName: string; filenamePrefix: string; contentType: string }> = {
  pairwise_alignment: {
    objectName: "pairwise-result.json",
    filenamePrefix: "genithm-pairwise",
    contentType: "application/json; charset=utf-8",
  },
  multiple_sequence_alignment: {
    objectName: "msa-result.fasta",
    filenamePrefix: "genithm-msa",
    contentType: "text/plain; charset=utf-8",
  },
  phylogenetic_tree: {
    objectName: "tree-result.nwk",
    filenamePrefix: "genithm-tree",
    contentType: "text/plain; charset=utf-8",
  },
  sequence_insights: {
    objectName: "sequence-insights-result.json",
    filenamePrefix: "genithm-sequence-insights",
    contentType: "application/json; charset=utf-8",
  },
  protein_properties: {
    objectName: "protein-properties.json",
    filenamePrefix: "genithm-protein-properties",
    contentType: "application/json; charset=utf-8",
  },
};

export type ScientificResultRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  job_type: string;
  status: string;
  result_object_path: string | null;
  result_sha256: string | null;
  result_bytes: number | null;
};

export class ScientificResultIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScientificResultIntegrityError";
  }
}

function requireIntegrity(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ScientificResultIntegrityError(message);
}

export function scientificResultDescriptor(job: ScientificResultRecord) {
  requireIntegrity(job.status === "completed", "Scientific result is not completed.");
  requireIntegrity(
    UUID.test(job.id) && UUID.test(job.organization_id) && UUID.test(job.project_id),
    "Scientific result ownership identifiers are invalid.",
  );
  const format = RESULT_FORMATS[job.job_type];
  requireIntegrity(Boolean(format), "Scientific result type is not approved for download.");
  requireIntegrity(
    typeof job.result_sha256 === "string" && SHA256.test(job.result_sha256),
    "Scientific result digest is missing or invalid.",
  );
  requireIntegrity(
    typeof job.result_bytes === "number" &&
    Number.isSafeInteger(job.result_bytes) &&
    job.result_bytes > 0 &&
    job.result_bytes <= MAX_SCIENTIFIC_RESULT_BYTES,
    "Scientific result size is missing or outside approved bounds.",
  );
  const expectedPath =
    `${job.organization_id}/${job.project_id}/${job.id}/${format.objectName}`;
  requireIntegrity(job.result_object_path === expectedPath, "Scientific result storage ownership mismatch.");
  const ext = format.objectName.split(".").at(-1);
  return {
    objectPath: expectedPath,
    filename: `${format.filenamePrefix}-${job.id}.${ext}`,
    contentType: format.contentType,
    expectedSha256: job.result_sha256,
    expectedBytes: job.result_bytes,
  };
}

export async function verifiedScientificResultBytes(
  blob: Blob,
  expectedBytes: number,
  expectedSha256: string,
): Promise<ArrayBuffer> {
  requireIntegrity(
    Number.isSafeInteger(expectedBytes) && expectedBytes > 0 &&
    expectedBytes <= MAX_SCIENTIFIC_RESULT_BYTES && blob.size === expectedBytes,
    "Downloaded scientific artifact size differs from recorded evidence.",
  );
  requireIntegrity(SHA256.test(expectedSha256), "Recorded result digest is invalid.");
  const bytes = await blob.arrayBuffer();
  requireIntegrity(bytes.byteLength === expectedBytes, "Downloaded scientific artifact size changed.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actualSha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  requireIntegrity(
    actualSha256 === expectedSha256,
    "Downloaded scientific artifact does not match recorded SHA-256.",
  );
  return bytes;
}
