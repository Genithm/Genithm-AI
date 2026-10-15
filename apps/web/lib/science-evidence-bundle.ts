import type { ConversationDossier, DossierFinding, DossierStep } from "./conversation-research-dossier.ts";

/**
 * Science V30: a portable record of already RLS-scoped dossier evidence.
 *
 * A SHA-256 digest detects accidental corruption against a digest recorded
 * elsewhere. It does NOT provide provenance authentication, a digital
 * signature, scientific verification, or artifact-byte verification.
 */
export const SCIENCE_BUNDLE_VERSION = "genithm-science-evidence/1" as const;
export const BUNDLE_LIMITATION =
  "This package includes recorded, access-scoped metadata only. Its checksum is not a signature or proof of source authenticity. Result artifact bytes are absent and must be verified through the authenticated integrity-checked download route. Computational results are not experimental validation.";

type BundleDossier = Pick<ConversationDossier, "version" | "conversation_id" | "status" | "counts" | "findings" | "caveats">;
export type ScienceEvidenceBundle = {
  format: typeof SCIENCE_BUNDLE_VERSION;
  payload: {
    exported_at: string;
    dossier: BundleDossier;
    limitation: typeof BUNDLE_LIMITATION;
  };
  integrity: { algorithm: "SHA-256"; payload_sha256: string };
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const STATES = new Set(["awaiting_approval", "running", "completed", "failed", "inconclusive", "unknown"]);
const STEP_STATES = new Set([...STATES, "not_started"]);
const KINDS = new Set(["scientific_job", "blast_job", "sequence_retrieval", "protein_annotation_job", "ai_workflow"]);
const STATUS = new Set(["empty", "awaiting_approval", "running", "complete", "partial", "failed"]);
const COUNT_KEYS = ["total", "completed", "running", "awaiting_approval", "failed", "inconclusive", "unknown"] as const;
const ALLOWED_METRICS = new Set([
  "operation", "sequence type", "sequence length", "orf count", "reported orfs",
  "frame count", "motif hits", "reported hits", "output length", "length",
  "Molecular weight (Da)", "gravy", "aromaticity fraction", "Estimated pI",
  "Estimated charge at pH 7", "score", "identity percent", "aligned length",
  "alignment length", "matches", "mismatches", "gaps", "sequence count",
  "strategy", "model", "leaf count", "internal support count",
  "hit count", "hits count", "total hits", "query length", "query length bases",
  "alignments", "best evalue", "best bitscore", "best identity percent",
  "program", "database name", "NCBI accession", "NCBI database",
  "Validated sequence reference", "RefSeq accession", "UniProt accession",
  "Protein", "uniprot reviewed",
]);

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key));
}
function string(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !/[<>\u0000-\u001f]/.test(value);
}
function uuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function uuidOrNull(value: unknown): boolean { return value === null || uuid(value); }
function shaOrNull(value: unknown): boolean { return value === null || (typeof value === "string" && SHA256.test(value)); }

function validStep(raw: unknown): raw is DossierStep {
  const v = obj(raw);
  return !!v && exactKeys(v, ["label","state","job_id","result_sha256"]) &&
    string(v.label, 100) && STEP_STATES.has(String(v.state)) &&
    uuidOrNull(v.job_id) && shaOrNull(v.result_sha256) &&
    (v.state === "completed" || v.result_sha256 === null);
}
function validFinding(raw: unknown): raw is DossierFinding {
  const v = obj(raw);
  if (!v || !exactKeys(v, [
    "plan_id","pipeline_id","source","action","state","kind","resource_id",
    "metrics","result_sha256","verified_download","steps",
  ])) return false;
  if (!uuidOrNull(v.plan_id) || !uuidOrNull(v.pipeline_id) ||
      !["plan","fixed_pipeline"].includes(String(v.source)) ||
      !string(v.action, 100) || !STATES.has(String(v.state)) ||
      !(v.kind === null || KINDS.has(String(v.kind))) ||
      !uuidOrNull(v.resource_id) || !shaOrNull(v.result_sha256) ||
      !Array.isArray(v.metrics) || v.metrics.length > 12 ||
      !Array.isArray(v.steps) || v.steps.length > 5 ||
      !v.steps.every(validStep)) return false;
  if (v.source === "plan" ? (v.plan_id === null || v.pipeline_id !== null) :
      (v.pipeline_id === null || v.plan_id !== null)) return false;
  if (v.state !== "completed" && (v.result_sha256 !== null ||
      v.verified_download !== null || v.metrics.length > 0)) return false;
  if (v.verified_download !== null &&
      (v.state !== "completed" || !uuid(v.resource_id) ||
       typeof v.verified_download !== "string" ||
       v.verified_download !== "/dashboard/scientific-jobs/" + v.resource_id + "/download" ||
       v.result_sha256 === null)) return false;
  return v.metrics.every((metric: unknown) => {
    const m = obj(metric);
    return !!m && exactKeys(m, ["label","value"]) &&
      typeof m.label === "string" && ALLOWED_METRICS.has(m.label) &&
      string(m.value, 120);
  });
}
function validDossier(raw: unknown): raw is ConversationDossier {
  const v = obj(raw);
  if (!v || !exactKeys(v, ["version","conversation_id","status","counts","findings","caveats"]) ||
      v.version !== "science-dossier-v19" || !uuid(v.conversation_id) ||
      !STATUS.has(String(v.status)) || !Array.isArray(v.findings) ||
      v.findings.length > 200 || !v.findings.every(validFinding) ||
      !Array.isArray(v.caveats) || v.caveats.length > 12 ||
      !v.caveats.every((item: unknown) => string(item, 320))) return false;
  const counts = obj(v.counts);
  if (!counts || !exactKeys(counts, COUNT_KEYS)) return false;
  for (const key of COUNT_KEYS) {
    const n = counts[key];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > 200) return false;
  }
  if (counts.total !== v.findings.length) return false;
  for (const key of COUNT_KEYS.slice(1)) {
    if (counts[key] !== v.findings.filter((f: DossierFinding) => f.state === key).length) return false;
  }
  if (v.status === "empty" && counts.total !== 0) return false;
  if (v.status === "complete" && (counts.total === 0 || counts.completed !== counts.total)) return false;
  return true;
}

/** Deterministic structural projection; never serialize arbitrary row props. */
function projectDossier(d: ConversationDossier): BundleDossier {
  return {
    version: d.version,
    conversation_id: d.conversation_id,
    status: d.status,
    counts: { total:d.counts.total, completed:d.counts.completed,
      running:d.counts.running, awaiting_approval:d.counts.awaiting_approval,
      failed:d.counts.failed, inconclusive:d.counts.inconclusive,
      unknown:d.counts.unknown },
    findings: d.findings.map((f) => ({
      plan_id:f.plan_id, pipeline_id:f.pipeline_id, source:f.source,
      action:f.action, state:f.state, kind:f.kind, resource_id:f.resource_id,
      metrics:f.metrics.map((m) => ({label:m.label, value:m.value})),
      result_sha256:f.result_sha256, verified_download:f.verified_download,
      steps:f.steps.map((s) => ({label:s.label, state:s.state,
        job_id:s.job_id, result_sha256:s.result_sha256})),
    })),
    caveats: [...d.caveats],
  };
}

/** Unicode JSON data and keys have deterministic byte serialization. */
export function canonicalScienceJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalScienceJson).join(",") + "]";
  const v = obj(value);
  if (v) return "{" + Object.keys(v).sort().map((key) =>
    JSON.stringify(key) + ":" + canonicalScienceJson(v[key])).join(",") + "}";
  throw new TypeError("Evidence bundle contains unsupported or non-finite data");
}

async function sha256(contents: string): Promise<string> {
  const bytes = new TextEncoder().encode(contents);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,"0")).join("");
}

export async function createScienceEvidenceBundle(
  dossier: ConversationDossier,
  now = new Date(),
): Promise<ScienceEvidenceBundle> {
  if (!validDossier(dossier)) throw new TypeError("Incomplete or malformed research dossier");
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid export timestamp");
  const payload = {
    exported_at: now.toISOString(),
    dossier: projectDossier(dossier),
    limitation: BUNDLE_LIMITATION,
  };
  return {
    format: SCIENCE_BUNDLE_VERSION,
    payload,
    integrity: {algorithm:"SHA-256",payload_sha256:await sha256(canonicalScienceJson(payload))},
  };
}

export async function verifyScienceEvidenceBundle(
  raw: unknown,
): Promise<{valid: boolean; reason: string}> {
  const bundle = obj(raw);
  if (!bundle || !exactKeys(bundle, ["format","payload","integrity"]) ||
      bundle.format !== SCIENCE_BUNDLE_VERSION) {
    return { valid:false, reason:"Unsupported bundle format" };
  }
  const payload = obj(bundle.payload);
  const digest = obj(bundle.integrity);
  if (!payload || !digest ||
      !exactKeys(payload, ["exported_at","dossier","limitation"]) ||
      !exactKeys(digest, ["algorithm","payload_sha256"]) ||
      digest.algorithm !== "SHA-256" || !string(digest.payload_sha256,64) ||
      !SHA256.test(digest.payload_sha256) ||
      payload.limitation !== BUNDLE_LIMITATION ||
      !validDossier(payload.dossier) ||
      typeof payload.exported_at !== "string") {
    return { valid:false, reason:"Invalid research metadata or constraints" };
  }
  const timestamp = new Date(payload.exported_at);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== payload.exported_at) {
    return {valid:false, reason:"Invalid export timestamp"};
  }
  // Reject extra fields rather than letting their bytes or secrets travel
  // under a legitimate digest. The dossier projection must be exact.
  if (canonicalScienceJson(payload.dossier) !== canonicalScienceJson(projectDossier(payload.dossier))) {
    return {valid:false, reason:"Unexpected research metadata fields"};
  }
  const actual = await sha256(canonicalScienceJson(payload));
  if (actual !== digest.payload_sha256) return {valid:false, reason:"Bundle fingerprint mismatch"};
  return {valid:true,reason:"Bundle metadata fingerprint matches. Artifact bytes, source authenticity, and biological claims have NOT been independently verified."};
}
