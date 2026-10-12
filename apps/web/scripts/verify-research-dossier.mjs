#!/usr/bin/env node
/**
 * Verify a downloaded Genithm V12 research dossier's internal package SHA-256.
 *
 * Usage: node --experimental-strip-types scripts/verify-research-dossier.mjs file.json
 * This verifies transport/storage consistency of the exported payload. It cannot
 * independently authenticate database report seals or scientific validity.
 */
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createHash } from "node:crypto";
import { canonicalDossierJson, validateDossierSelection } from "../lib/research-dossier.ts";

async function verify(filePath) {
  const stat = await import("node:fs/promises").then(fs => fs.stat(filePath));
  if (!stat.isFile() || stat.size > 3 * 1024 * 1024 || stat.size < 10) {
    throw new Error("Dossier file is empty or exceeds the approved size bound.");
  }
  const text = await readFile(filePath, "utf8");
  const dossier = JSON.parse(text);
  if (dossier?.schema_version !== "genithm-dossier-bundle/1" ||
      dossier?.payload?.schema_version !== "genithm-research-dossier/1" ||
      dossier?.checksum?.scope !== "payload" ||
      dossier?.checksum?.algorithm !== "SHA-256" ||
      !Array.isArray(dossier.payload.reports)) {
    throw new Error("Unsupported dossier format or checksum definition.");
  }
  const { project_id: projectId, reports } = dossier.payload;
  validateDossierSelection(projectId, reports.map(report => report.report_id));
  for (const report of reports) {
    if (report?.snapshot?.project?.id !== projectId ||
        report?.snapshot?.source?.resource_type !== report.source_type ||
        report?.snapshot?.source?.resource_id !== report.source_id ||
        typeof report.report_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(report.report_sha256)) {
      throw new Error("A dossier report has inconsistent recorded identity.");
    }
  }
  const canonical = canonicalDossierJson(dossier.payload);
  const computed = createHash("sha256").update(canonical, "utf8").digest("hex");
  if (computed !== dossier.checksum.canonical_payload_sha256) {
    throw new Error("Checksum mismatch: the dossier payload has changed.");
  }
  return { checksum: computed, reportCount: reports.length };
}

try {
  if (process.argv.length !== 3) throw new Error("Usage: verify-research-dossier.mjs <dossier.json>");
  const result = await verify(process.argv[2]);
  process.stdout.write("Dossier checksum OK · " + result.reportCount +
    " report snapshots · SHA-256 " + result.checksum + "\n");
  process.stdout.write("Note: This is checksum consistency only, not an external signature or independent scientific validation.\n");
} catch (error) {
  process.stderr.write("Dossier verification failed: " +
    (error instanceof Error ? error.message : "unknown error") + "\n");
  process.exitCode = 1;
}
