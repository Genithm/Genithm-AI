#!/usr/bin/env node
/**
 * Science V30: network-free integrity check for exported dossier metadata.
 * Usage:
 *   node --experimental-strip-types scripts/verify_science_evidence_bundle.mjs <bundle.json> [expected_sha256]
 *
 * An attacker able to change both the bundle and its fingerprint can forge
 * this check. Record/share the expected digest separately for comparison.
 * No artifact bytes, Supabase records, or biological results are verified.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyScienceEvidenceBundle } from "../apps/web/lib/science-evidence-bundle.ts";

const digestPattern = /^[a-f0-9]{64}$/;

async function main(argv) {
  if (argv.length < 1 || argv.length > 2 ||
      (argv.length === 2 && !digestPattern.test(argv[1]))) {
    console.error("Usage: node --experimental-strip-types scripts/verify_science_evidence_bundle.mjs <bundle.json> [expected_sha256]");
    return 2;
  }
  try {
    const file = resolve(argv[0]);
    const meta = await stat(file);
    if (!meta.isFile() || meta.size < 1 || meta.size > 2_000_000) {
      throw new Error("Evidence bundle file is missing or exceeds the 2 MB bound");
    }
    const buffer = await readFile(file, "utf8");
    const raw = JSON.parse(buffer);
    const check = await verifyScienceEvidenceBundle(raw);
    if (!check.valid) {
      console.error("FAIL: " + check.reason);
      return 1;
    }
    if (argv[1] && raw.integrity.payload_sha256 !== argv[1]) {
      console.error("FAIL: separately recorded SHA-256 fingerprint does not match");
      return 1;
    }
    console.log("PASS: " + check.reason);
    if (!argv[1]) {
      console.log("No independently recorded expected SHA-256 was provided. This check detects accidental corruption only.");
    }
    console.log("Recorded payload SHA-256: " + raw.integrity.payload_sha256);
    return 0;
  } catch {
    // Errors can contain local paths / private report text; don't print them.
    console.error("FAIL: could not parse or validate the bounded evidence bundle.");
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
