import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

type EvidenceEntry = {
  accession: string;
  name: string | null;
  type: string | null;
  sourceDatabase: "interpro" | "pfam";
  locations: Array<{ start: number; end: number }>;
};

function evidenceEntries(value: unknown, sourceDatabase: "interpro" | "pfam"): EvidenceEntry[] {
  if (!Array.isArray(value)) return [];
  const output: EvidenceEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.accession !== "string") continue;
    const locations: Array<{ start: number; end: number }> = [];
    if (Array.isArray(item.locations)) {
      for (const location of item.locations) {
        if (!isRecord(location) || typeof location.start !== "number" || typeof location.end !== "number") continue;
        if (Number.isInteger(location.start) && Number.isInteger(location.end) && location.start >= 1 && location.end >= location.start) {
          locations.push({ start: location.start, end: location.end });
        }
      }
    }
    output.push({
      accession: item.accession,
      name: typeof item.name === "string" ? item.name : null,
      type: typeof item.type === "string" ? item.type : null,
      sourceDatabase,
      locations,
    });
  }
  return output;
}

function evidenceUrl(entry: EvidenceEntry) {
  if (entry.sourceDatabase === "interpro" && /^IPR\d{6}$/.test(entry.accession)) {
    return `https://www.ebi.ac.uk/interpro/entry/InterPro/${entry.accession}/`;
  }
  if (entry.sourceDatabase === "pfam" && /^PF\d{5}$/.test(entry.accession)) {
    return `https://www.ebi.ac.uk/interpro/entry/pfam/${entry.accession}/`;
  }
  return null;
}

function hashLine(label: string, sha: string | null, bytes: number | null) {
  if (!sha) return null;
  return <div className="small"><strong>{label}</strong>: <code>{sha}</code>{bytes ? ` · ${bytes} bytes` : ""}</div>;
}

export default async function ProteinAnnotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirect("/login");

  const { data: job, error } = await supabase.from("protein_annotation_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !job) notFound();

  const genes = stringArray(job.gene_names);
  const interpro = evidenceEntries(job.interpro_entries, "interpro");
  const pfam = evidenceEntries(job.pfam_entries, "pfam");
  const uniprotUrl = job.uniprot_accession && /^[A-Z0-9-]{6,20}$/.test(job.uniprot_accession)
    ? `https://www.uniprot.org/uniprotkb/${job.uniprot_accession}/entry`
    : null;

  return (
    <main className="container dashboard">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">Protein evidence</div>
          <h2>{job.protein_name ?? "Evidence-backed protein annotation"}</h2>
          <p className="small">RefSeq {job.refseq_accession} · annotation job {job.id}</p>
        </div>
        <Link className="button" href="/dashboard">Back to dashboard</Link>
      </header>

      <section className="card">
        <div className="dashboard-header">
          <div>
            <strong>{job.status.replaceAll("_", " ")}</strong>
            <div className="small">Connector: {job.connector_version ?? "pending"} · freshness: live source, no silent cache reuse</div>
          </div>
          {uniprotUrl ? <a className="button primary" href={uniprotUrl} target="_blank" rel="noreferrer">Open UniProtKB</a> : null}
        </div>
        <div className="small">Requested {new Date(job.created_at).toLocaleString()}{job.source_checked_at ? ` · live sources checked ${new Date(job.source_checked_at).toLocaleString()}` : ""}</div>
        {job.result_message ? <div className="notice" style={{ marginTop: 12 }}>{job.result_message}</div> : null}
        {job.processing_error ? <div className="error" style={{ marginTop: 12 }}>{job.processing_error}</div> : null}
      </section>

      {job.status === "completed" ? <>
        <div className="section-grid" style={{ marginTop: 18 }}>
          <section className="card">
            <div className="eyebrow">Identity</div><h3>UniProtKB mapping</h3>
            <div className="list">
              <div className="item"><strong>RefSeq accession</strong><div>{job.refseq_accession}</div></div>
              <div className="item"><strong>UniProt accession</strong><div>{job.uniprot_accession ?? "n/a"}</div></div>
              <div className="item"><strong>UniProt entry</strong><div>{job.uniprot_entry_id ?? "n/a"}</div></div>
              <div className="item"><strong>Review status</strong><div>{job.uniprot_reviewed ? "Reviewed UniProtKB (Swiss-Prot)" : "Unreviewed UniProtKB"}</div></div>
              <div className="item"><strong>Mapping candidates</strong><div>{job.mapping_candidate_count ?? "n/a"}</div></div>
              <div className="item"><strong>Sequence identity gate</strong><div>Exact immutable sequence SHA-256 match required</div></div>
            </div>
          </section>

          <section className="card">
            <div className="eyebrow">Biological context</div><h3>Source-supported metadata</h3>
            <div className="list">
              <div className="item"><strong>Protein name</strong><div>{job.protein_name ?? "Unavailable"}</div></div>
              <div className="item"><strong>Organism</strong><div>{job.organism_name ?? "Unavailable"}</div></div>
              <div className="item"><strong>Gene names</strong><div>{genes.length ? genes.join(", ") : "Unavailable"}</div></div>
              <div className="item"><strong>UniProt release</strong><div>{job.uniprot_release ?? "Unavailable"}{job.uniprot_release_date ? ` · ${job.uniprot_release_date}` : ""}</div></div>
            </div>
          </section>
        </div>

        <section className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Domains and families</div><h3>InterPro evidence</h3>
          <div className="list">{interpro.map((entry) => {
            const url = evidenceUrl(entry);
            return <div className="item" key={`interpro-${entry.accession}`}>
              <div className="dashboard-header"><div><strong>{entry.accession}{entry.name ? ` · ${entry.name}` : ""}</strong><div className="small">{entry.type ?? "InterPro entry"}</div></div>{url ? <a className="button" href={url} target="_blank" rel="noreferrer">Open evidence</a> : null}</div>
              <div className="small">Locations: {entry.locations.length ? entry.locations.map((location) => `${location.start}–${location.end}`).join(", ") : "No normalized residue coordinates returned"}</div>
            </div>;
          })}{!interpro.length ? <div className="notice">No InterPro entries were returned for the selected exact-match UniProt protein at request time.</div> : null}</div>
        </section>

        <section className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Protein families</div><h3>Pfam evidence</h3>
          <div className="list">{pfam.map((entry) => {
            const url = evidenceUrl(entry);
            return <div className="item" key={`pfam-${entry.accession}`}>
              <div className="dashboard-header"><div><strong>{entry.accession}{entry.name ? ` · ${entry.name}` : ""}</strong><div className="small">{entry.type ?? "Pfam entry"}</div></div>{url ? <a className="button" href={url} target="_blank" rel="noreferrer">Open evidence</a> : null}</div>
              <div className="small">Locations: {entry.locations.length ? entry.locations.map((location) => `${location.start}–${location.end}`).join(", ") : "No normalized residue coordinates returned"}</div>
            </div>;
          })}{!pfam.length ? <div className="notice">No Pfam entries were returned for the selected exact-match UniProt protein at request time.</div> : null}</div>
        </section>

        <section className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">Evidence provenance</div><h3>Source integrity</h3>
          <div className="small">Input SHA-256: <code>{job.input_sha256}</code></div>
          {hashLine("UniProt sequence SHA-256", job.uniprot_sequence_sha256, null)}
          {hashLine("UniProt mapping response", job.mapping_response_sha256, job.mapping_response_bytes)}
          {hashLine("UniProt record response", job.uniprot_response_sha256, job.uniprot_response_bytes)}
          {hashLine("InterPro response", job.interpro_response_sha256, job.interpro_response_bytes)}
          {hashLine("Pfam response", job.pfam_response_sha256, job.pfam_response_bytes)}
          <div className="notice" style={{ marginTop: 16 }}>These annotations are source-backed evidence, not Genithm-generated functional predictions. Absence of an entry does not prove absence of a domain or function.</div>
        </section>
      </> : null}

      {job.status === "no_mapping" ? <section className="card" style={{ marginTop: 18 }}><div className="notice">No UniProtKB mapping was returned for this exact RefSeq accession during this live source check. Genithm did not infer or substitute a functional annotation.</div></section> : null}
      {job.status === "queued" || job.status === "retrieving" ? <section className="card" style={{ marginTop: 18 }}><div className="notice">The source worker has not completed this live evidence request yet. The page will show source identities, domains and provenance after completion.</div></section> : null}
    </main>
  );
}
