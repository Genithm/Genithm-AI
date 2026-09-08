import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type EvidenceRow = {
  interpretation_request_id: string;
  conversation_id: string;
  project_id: string;
  resource_type: string;
  resource_id: string;
  evidence_schema_version: string;
  evidence_snapshot: unknown;
  evidence_sha256: string;
  evidence_integrity_ok: boolean;
  created_at: string;
};

type EvidenceFact = {
  id: string;
  label: string;
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function factsFromSnapshot(value: unknown): EvidenceFact[] {
  if (!isRecord(value) || value.schema_version !== "ai-evidence-v1" || !Array.isArray(value.facts)) return [];
  return value.facts.flatMap((fact) => {
    if (!isRecord(fact) || typeof fact.id !== "string" || typeof fact.label !== "string") return [];
    return [{ id: fact.id, label: fact.label, value: fact.value }];
  });
}

function readable(value: string) {
  return value.replaceAll("_", " ");
}

function topHits(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((hit) => {
    if (!isRecord(hit)) return [];
    return [{
      rank: typeof hit.rank === "number" ? hit.rank : null,
      subjectId: typeof hit.subject_id === "string" ? hit.subject_id : null,
      title: typeof hit.title === "string" ? hit.title : null,
      identityPercent: typeof hit.identity_percent === "number" ? hit.identity_percent : null,
      alignmentLength: typeof hit.alignment_length === "number" ? hit.alignment_length : null,
      queryCoveragePercent: typeof hit.query_coverage_percent === "number" ? hit.query_coverage_percent : null,
      eValue: typeof hit.e_value === "number" ? hit.e_value : null,
      bitScore: typeof hit.bit_score === "number" ? hit.bit_score : null,
    }];
  }).slice(0, 10);
}

function EvidenceValue({ fact }: { fact: EvidenceFact }) {
  if (fact.id === "top_hits") {
    const hits = topHits(fact.value);
    if (!hits.length) return <div className="small">No normalized hits were recorded in this frozen snapshot.</div>;
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Rank</th>
              <th align="left">Subject</th>
              <th align="left">Title</th>
              <th align="right">Identity %</th>
              <th align="right">Query coverage %</th>
              <th align="right">Align length</th>
              <th align="right">E-value</th>
              <th align="right">Bit score</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit, index) => (
              <tr key={`${hit.subjectId ?? "hit"}-${index}`}>
                <td>{hit.rank ?? "—"}</td>
                <td><code>{hit.subjectId ?? "—"}</code></td>
                <td>{hit.title ?? "—"}</td>
                <td align="right">{hit.identityPercent ?? "—"}</td>
                <td align="right">{hit.queryCoveragePercent ?? "—"}</td>
                <td align="right">{hit.alignmentLength ?? "—"}</td>
                <td align="right">{hit.eValue ?? "—"}</td>
                <td align="right">{hit.bitScore ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 0 }}>{JSON.stringify(fact.value, null, 2)}</pre>;
}

export default async function AiEvidencePage({ params, searchParams }: { params: Promise<{ interpretationId: string }>; searchParams: Promise<{ fact?: string }> }) {
  const { interpretationId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const rpc = supabase.rpc as unknown as <T>(name: string, args: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { message: string } | null }>;
  const { data, error } = await rpc<EvidenceRow[]>("get_ai_interpretation_evidence", { interpretation_request_id: interpretationId });
  const evidence = data?.[0];
  if (error || !evidence) notFound();

  const facts = factsFromSnapshot(evidence.evidence_snapshot);
  const highlightedFact = query.fact && facts.some((fact) => fact.id === query.fact) ? query.fact : null;

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Authoritative frozen evidence</div>
          <h2>Evidence explorer</h2>
          <p className="small">{readable(evidence.resource_type)} · resource <code>{evidence.resource_id}</code></p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="button" href={`/dashboard/ai/${evidence.conversation_id}`}>Back to conversation</Link>
          <Link className="button" href="/dashboard/ai">AI workspace</Link>
        </div>
      </header>

      <section className="card">
        <div className="eyebrow">Integrity</div>
        <h3>{evidence.evidence_integrity_ok ? "Frozen snapshot verified" : "Evidence integrity check failed"}</h3>
        <div className="small">Schema: {evidence.evidence_schema_version} · frozen {new Date(evidence.created_at).toLocaleString()}</div>
        <div className="small">Evidence SHA-256: <code>{evidence.evidence_sha256}</code></div>
        {evidence.evidence_integrity_ok ? (
          <div className="notice" style={{ marginTop: 12 }}>The database recomputed the SHA-256 of this immutable evidence snapshot and it matches the hash recorded for the interpretation.</div>
        ) : (
          <div className="error" style={{ marginTop: 12 }}>Do not rely on the values below. The stored snapshot no longer matches its recorded SHA-256.</div>
        )}
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow">Evidence facts</div>
        <h3>Exact facts supplied to the AI interpreter</h3>
        <div className="notice">These values are the frozen authoritative evidence input. They are separate from AI interpretation and follow-up explanation. This page does not perform a new source lookup or rerun a scientific tool.</div>
        <div className="list" style={{ marginTop: 12 }}>
          {facts.map((fact) => (
            <div className="item" id={`evidence-${fact.id}`} key={fact.id} style={highlightedFact === fact.id ? { outline: "2px solid currentColor", outlineOffset: 2 } : undefined}>
              <div className="dashboard-header">
                <div>
                  <strong>{fact.label}</strong>
                  <div className="small">Evidence ID: <code>{fact.id}</code></div>
                </div>
                <Link className="button" href={`/dashboard/ai/evidence/${evidence.interpretation_request_id}?fact=${encodeURIComponent(fact.id)}#evidence-${encodeURIComponent(fact.id)}`}>Permalink</Link>
              </div>
              {evidence.evidence_integrity_ok ? <EvidenceValue fact={fact} /> : <div className="small">Value hidden from trusted presentation because integrity verification failed.</div>}
            </div>
          ))}
          {!facts.length ? <div className="notice">This interpretation does not contain a valid ai-evidence-v1 fact list.</div> : null}
        </div>
      </section>
    </main>
  );
}
