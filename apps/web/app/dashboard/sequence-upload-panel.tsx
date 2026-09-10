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
};

type ReservationResponse = {
  upload_id: string;
  object_path: string;
  upload_url: string;
  method: "PUT";
  required_headers: Record<string, string>;
  expires_seconds: number;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["fa", "fasta", "fna", "faa", "fas", "txt"]);
const API_BASE = (process.env.NEXT_PUBLIC_GENITHM_API_URL || "http://localhost:8000").replace(/\/$/, "");

function safeDisplayFilename(name: string) {
  const trimmed = name.trim().slice(0, 255);
  return trimmed || "sequence.fasta";
}

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
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

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.detail === "string") return payload.detail;
  } catch {
    // Use the stable fallback below.
  }
  return fallback;
}

export function SequenceUploadPanel({ projects }: Props) {
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
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) throw new Error("Your session expired. Sign in again before uploading.");

      const originalFilename = safeDisplayFilename(file.name);
      const contentType = file.type || "application/octet-stream";
      const reservationResponse = await fetch(`${API_BASE}/api/v1/storage/sequence-uploads`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: selectedProject.id,
          original_filename: originalFilename,
          file_size_bytes: file.size,
          content_type: contentType,
        }),
      });
      if (!reservationResponse.ok) {
        throw new Error(await responseError(reservationResponse, "Could not reserve a secure upload slot."));
      }
      const reservation = (await reservationResponse.json()) as ReservationResponse;

      const uploadResponse = await fetch(reservation.upload_url, {
        method: reservation.method,
        headers: reservation.required_headers,
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("The secure R2 upload failed. The reservation remains pending and is not queued for validation.");
      }

      const completionResponse = await fetch(`${API_BASE}/api/v1/storage/sequence-uploads/${reservation.upload_id}/complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!completionResponse.ok) {
        throw new Error(await responseError(completionResponse, "The file was uploaded but could not be queued for validation."));
      }
      const completion = (await completionResponse.json()) as { status?: string };
      if (completion.status !== "pending_validation") {
        throw new Error(`Unexpected upload state: ${completion.status ?? "unknown"}.`);
      }

      setFile(null);
      const input = document.getElementById("sequence-file") as HTMLInputElement | null;
      if (input) input.value = "";
      setMessage("Upload complete. The private R2 object was verified and queued for deterministic server-side validation.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
      router.refresh();
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
      <div className="small">Private R2 input · max 50 MiB · short-lived signed upload · deterministic server-side validation.</div>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      <button className="button primary" type="button" onClick={upload} disabled={busy || !file}>
        {busy ? "Uploading…" : "Upload FASTA securely"}
      </button>
    </div>
  );
}
