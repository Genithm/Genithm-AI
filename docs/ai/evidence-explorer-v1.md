# AI Evidence Explorer V1

The Evidence Explorer is a read-only provenance surface for evidence-grounded AI interpretation.

## Trust boundary

The explorer does not rebuild evidence from live scientific tables, call external sources, rerun tools, or ask a model to summarize evidence. It reads the exact `ai-evidence-v1` snapshot frozen when an interpretation request was created.

The database RPC `public.get_ai_interpretation_evidence(uuid)` is `SECURITY INVOKER`. RLS on `public.ai_interpretation_requests` remains the authorization boundary, so a caller can only inspect a completed interpretation already visible in their authorized scope.

Before returning the snapshot, the RPC recomputes SHA-256 over the stored JSONB text representation and compares it with the interpretation's recorded `evidence_sha256`. The UI labels a matching snapshot as verified. If the hash does not match, the page does not present evidence values as trusted.

## Evidence presentation

Each frozen fact is displayed as:

- evidence ID
- human-readable label
- bounded frozen value

BLAST `top_hits` is rendered only from the first up to 10 normalized hit records already frozen in the evidence snapshot. Raw BLAST XML is never exposed by the explorer.

Sequence retrieval evidence is limited to the frozen accession, source metadata, record metadata, freshness/provenance timestamps and response hash already present in `ai-evidence-v1`. Raw FASTA is not exposed here.

Protein annotation evidence is limited to the frozen identity, UniProt evidence, bounded annotation summary and source provenance hashes/releases already in the snapshot. Raw InterPro or Pfam response bodies are not exposed.

Scientific-job evidence shows only the frozen job/tool identity, bounded result summary, result hash and completion metadata included in the interpretation input.

## Separation from model output

The UI explicitly separates:

1. authoritative frozen evidence;
2. AI interpretation;
3. AI follow-up explanation.

The Evidence Explorer is the authoritative-input inspection surface. It does not make the model output authoritative and does not expand model permissions.

## Discovery

The Genithm AI workspace lists recent completed interpretations with links to their frozen evidence snapshots. The evidence detail page also links back to the originating conversation.
