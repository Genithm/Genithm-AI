import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { requestProteinAnnotation } from "./protein-annotation-actions";

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

export async function ProteinAnnotationPanel() {
  const supabase = await createClient();
  const [{ data: retrievals }, { data: uploads }, { data: jobs }, { data: projects }] = await Promise.all([
    supabase.from("sequence_retrievals")
      .select("id,project_id,sequence_upload_id,resolved_accession,status,source_database")
      .eq("source_database", "protein")
      .eq("status", "retrieved")
      .not("sequence_upload_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("sequence_uploads")
      .select("id,project_id,original_filename,status,sequence_count,sequence_type,residue_count,sha256")
      .eq("status", "ready")
      .eq("sequence_type", "protein")
      .eq("sequence_count", 1)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("protein_annotation_jobs")
      .select("id,project_id,sequence_upload_id,refseq_accession,status,uniprot_accession,uniprot_reviewed,protein_name,organism_name,source_checked_at,interpro_entries,pfam_entries,processing_error,created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("projects").select("id,name"),
  ]);

  const uploadById = new Map((uploads ?? []).map((upload) => [upload.id, upload]));
  const projectById = new Map((projects ?? []).map((project) => [project.id, project.name]));
  const eligible = (retrievals ?? []).flatMap((retrieval) => {
    if (!retrieval.sequence_upload_id) return [];
    const upload = uploadById.get(retrieval.sequence_upload_id);
    if (!upload || !upload.sha256) return [];
    return [{ retrieval, upload }];
  });

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Protein evidence</div>
      <h2>UniProt, InterPro and Pfam annotation</h2>
      <p>
        V1 accepts proteins that came from an authoritative NCBI protein retrieval. The source worker maps the exact RefSeq accession to UniProtKB,
        requires exact sequence identity with the immutable Genithm input, then retrieves InterPro and Pfam evidence from live official sources.
      </p>

      <h3>Eligible NCBI-derived proteins</h3>
      {eligible.length ? <div className="list">{eligible.map(({ retrieval, upload }) => <div className="item" key={retrieval.id}>
        <div className="dashboard-header">
          <div>
            <strong>{retrieval.resolved_accession ?? "RefSeq protein"} · {upload.original_filename}</strong>
            <div className="small">{projectById.get(upload.project_id) ?? "Project"} · {upload.residue_count ?? 0} residues · SHA-256 {upload.sha256?.slice(0, 20)}…</div>
          </div>
          <form action={requestProteinAnnotation}>
            <input type="hidden" name="project_id" value={upload.project_id} />
            <input type="hidden" name="sequence_upload_id" value={upload.id} />
            <button className="button primary">Fetch live protein evidence</button>
          </form>
        </div>
        <div className="small">A completed prior annotation is not silently reused as fresh evidence; every new request checks live sources.</div>
      </div>)}</div> : <div className="notice">Retrieve and validate a protein from NCBI before requesting evidence-backed annotation.</div>}

      <h3 style={{ marginTop: 24 }}>Recent annotation requests</h3>
      <div className="list">{(jobs ?? []).map((job) => {
        const interproCount = Array.isArray(job.interpro_entries) ? job.interpro_entries.length : 0;
        const pfamCount = Array.isArray(job.pfam_entries) ? job.pfam_entries.length : 0;
        return <div className="item" key={job.id}>
          <div className="dashboard-header">
            <div>
              <strong>{job.refseq_accession}{job.uniprot_accession ? ` → ${job.uniprot_accession}` : ""}</strong>
              <div className="small">{projectById.get(job.project_id) ?? "Project"} · {formatStatus(job.status)} · requested {new Date(job.created_at).toLocaleString()}</div>
            </div>
            <Link className="button" href={`/dashboard/protein-annotations/${job.id}`}>Open evidence</Link>
          </div>
          {job.status === "completed" ? <>
            <div>{job.protein_name ?? "Protein name unavailable"}</div>
            <div className="small">{job.organism_name ?? "Organism unavailable"} · {job.uniprot_reviewed ? "reviewed UniProtKB" : "unreviewed UniProtKB"} · InterPro {interproCount} · Pfam {pfamCount}</div>
            {job.source_checked_at ? <div className="small">Live sources checked {new Date(job.source_checked_at).toLocaleString()}</div> : null}
          </> : null}
          {job.status === "no_mapping" ? <div className="notice">No UniProtKB mapping was returned for this exact RefSeq accession at request time.</div> : null}
          {job.processing_error ? <div className="error">Annotation error: {job.processing_error}</div> : null}
        </div>;
      })}{!jobs?.length ? <div className="notice">No protein annotation requests yet.</div> : null}</div>
    </section>
  );
}
