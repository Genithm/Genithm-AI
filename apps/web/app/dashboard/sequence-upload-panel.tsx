"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type ProjectOption = {
  id: string;
  organization_id: string;
  name: string;
};

type Props = {
  projects: ProjectOption[];
  userId: string;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["fa", "fasta", "fna", "faa", "fas", "txt"]);

function safeDisplayFilename(name: string) {
  const trimmed = name.trim().slice(0, 255);
  return trimmed || "sequence.fasta";
}

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function storageFilename(name: string) {
  const ext = extensionOf(name);
  return ext && ALLOWED_EXTENSIONS.has(ext) ? `input.${ext}` : "input.fasta";
}

async function validateFastaEnvelope(file: File) {
  if (file.size < 1) throw new Error("The selected file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("FASTA uploads are currently limited to 50 MiB.");

  const ext = extensionOf(file.name);
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Use a FASTA/text extension such as .fasta, .fa, .fna, .faa, .fas, or .txt.");
  }

  const prefix = await file.slice(0, 8192).text();
  const normalized = prefix.replace(/^\uFEFF/, "").trimStart();
  if (!normalized.startsWith(">")) {
    throw new Error("This does not look like FASTA: the first non-whitespace character must be >.");
  }
  if (normalized.includes("\u0000")) {
    throw new Error("Binary content is not accepted as FASTA input.");
  }
}

export function SequenceUploadPanel({ projects, userId }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = projects.find((project) => project.id === projectId);

  async function upload() {
    if (!file || !selectedProject) {
      setError("Select a project and a FASTA file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await validateFastaEnvelope(file);

      const uploadId = crypto.randomUUID();
      const originalFilename = safeDisplayFilename(file.name);
      const objectPath = `${selectedProject.organization_id}/${selectedProject.id}/${userId}/${uploadId}/${storageFilename(originalFilename)}`;

      const { error: reservationError } = await supabase.from("sequence_uploads").insert({
        id: uploadId,
        organization_id: selectedProject.organization_id,
        project_id: selectedProject.id,
        created_by: userId,
        original_filename: originalFilename,
        object_path: objectPath,
        file_size_bytes: file.size,
        content_type: file.type || "application/octet-stream",
      });

      if (reservationError) {
        throw new Error("Could not reserve a secure upload slot for this project.");
      }

      const { error: uploadError } = await supabase.storage
        .from("sequence-inputs")
        .upload(objectPath, file, {
          upsert: false,
          contentType: file.type || "application/octet-stream",
          cacheControl: "0",
        });

      if (uploadError) {
        throw new Error("The file record was created, but private Storage upload failed. Retry with a new file; stale reservations will be cleaned automatically in a later worker milestone.");
      }

      setFile(null);
      const input = document.getElementById("sequence-file") as HTMLInputElement | null;
      if (input) input.value = "";
      setMessage("Upload complete. The file is private and queued for server-side sequence validation.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!projects.length) {
    return <div className="notice">Create a project before uploading sequence data.</div>;
  }

  return (
    <div className="stack">
      <label>
        Project
        <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>
      <label>
        FASTA file
        <input
          id="sequence-file"
          type="file"
          accept=".fa,.fasta,.fna,.faa,.fas,.txt,text/plain"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="small">Private input · max 50 MiB · no overwrite · server-side validation follows upload.</div>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      <button className="button primary" type="button" onClick={upload} disabled={busy || !file}>
        {busy ? "Uploading…" : "Upload FASTA securely"}
      </button>
    </div>
  );
}
