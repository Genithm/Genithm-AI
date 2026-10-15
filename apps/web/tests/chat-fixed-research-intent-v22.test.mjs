import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseChatResearchProtocol } from "../lib/chat-research-protocol.ts";

// The same corpus is loaded by PostgreSQL in disposable Supabase CI.
// This guards against proposal/approval drift between JS and SQL parsers.
const corpus = readFileSync(
  new URL("../../../supabase/tests/v22_chat_intent_corpus.tsv", import.meta.url), "utf8",
).trimEnd().split("\n").slice(1).map((line) => {
  const [id, prompt, expectedTemplate, expectedAccession] = line.split("\t");
  assert.ok(id && prompt && expectedTemplate && expectedAccession, "invalid TSV fixture row");
  return { id, prompt, expectedTemplate, expectedAccession };
});

test("V22 TypeScript proposals agree with the approved shared research-intent corpus", () => {
  assert.ok(corpus.length >= 25, "regression corpus must cover direct and rejected requests");
  for (const row of corpus) {
    const result = parseChatResearchProtocol(row.prompt);
    assert.equal(result?.template ?? "-", row.expectedTemplate, row.id);
    assert.equal(result?.accession ?? "-", row.expectedAccession, row.id);
  }
});

test("V22 consent corpus contains rejection cases for overrides, identifiers and duplicate accessions", () => {
  for (const id of ["system_override", "developer_override", "action_digit", "action_underscore",
    "orf_digit", "orf_underscore", "escaped_linebreak", "multiple_kinds", "multiple_nucleotide"]) {
    const row = corpus.find((entry) => entry.id === id);
    assert.ok(row, id);
    assert.equal(row.expectedTemplate, "-", id);
  }
});
