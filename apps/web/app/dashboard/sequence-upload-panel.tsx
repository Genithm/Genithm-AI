"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import styles from "./sequence-upload-panel.module.css";

type ProjectOption = {
  id: string;
  organization_id: string;
  name: string;
};

type Props = {
  projects: ProjectOption[];
  userId?: string;
};

type ReservationResponse = {
  upload_id: string;
  object_path: string;
  upload_url: string;
  method: "PUT";
  required_headers: Record<string, string>;
  expires_seconds: number;
};

type UploadStage = "idle" | "reserving" | "uploading" | "queueing" | "queued";
type FileReadiness = "idle" | "checking" | "ready" | "invalid";

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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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

function stageComplete(stage: UploadStage, target: UploadStage) {
  const order: UploadStage[] = ["idle", "reserving", "uploading", "queueing", "queued"];
  return order.indexOf(stage) > order.indexOf(target);
}

export function SequenceUploadPanel({ projects }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<FileReadiness>("idle");
  const [stage, setStage] = useState<UploadStage>("idle");
  const [dragActive, setDragActive] = useState(false);

  const selectedProject = projects.find((project) => project.id === projectId);

  async function prepareFile(nextFile: File | null) {
    setMessage(null);
    setError(null);
    setStage("idle");
    setFile(nextFile);
    if (!nextFile) {
      setReadiness("idle");
      return;
    }

    setReadiness("checking");
    try {
      await validateFastaEnvelope(nextFile);
      setReadiness("ready");
    } catch (caught) {
      setReadiness("invalid");
      setError(caught instanceof Error ? caught.message : "The selected file could not be validated.");
    }
  }

  function clearSelection() {
    setFile(null);
    setReadiness("idle");
    setStage("idle");
    setError(null);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function upload() {
    if (!file || !selectedProject || readiness !== "ready") {
      setError("Select a project and a valid FASTA file first.");
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

      setStage("reserving");
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

      setStage("uploading");
      const uploadResponse = await fetch(reservation.upload_url, {
        method: reservation.method,
        headers: reservation.required_headers,
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("The secure R2 upload failed. The reservation remains pending and is not queued for validation.");
      }

      setStage("queueing");
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

      setStage("queued");
      setMessage("Upload complete. The private R2 object is now queued for deterministic server-side sequence validation.");
      setFile(null);
      setReadiness("idle");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
      setStage("idle");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!projects.length) {
    return (
      <div className={styles.emptyState}>
        <strong>Create a project before adding sequence data.</strong>
        <p>Your sequence inputs are stored inside a project so analyses, hashes, provenance, and reports stay attached to the correct research workspace.</p>
        <button className="button" type="button" onClick={() => document.querySelector("main.dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          Go to workspace setup
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <label>
        Project
        <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={busy}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>

      <div
        className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ""} ${readiness === "ready" ? styles.dropzoneReady : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          void prepareFile(event.dataTransfer.files?.[0] ?? null);
        }}
      >
        <input
          ref={inputRef}
          className={styles.fileInput}
          id="sequence-file"
          type="file"
          accept=".fa,.fasta,.fna,.faa,.fas,.txt,text/plain"
          disabled={busy}
          onChange={(event) => void prepareFile(event.target.files?.[0] ?? null)}
        />
        <label className={styles.fileLabel} htmlFor="sequence-file">
          <span className={styles.fileIcon} aria-hidden="true">FA</span>
          <span>
            <strong>{file ? file.name : "Drop a FASTA file here, or choose a file"}</strong>
            <small>{file ? `${formatFileSize(file.size)} · ${readiness === "checking" ? "checking file envelope…" : readiness === "ready" ? "ready for secure upload" : "needs attention"}` : ".fasta, .fa, .fna, .faa, .fas or .txt · max 50 MiB"}</small>
          </span>
        </label>
        {file ? <button className={styles.clearButton} type="button" onClick={clearSelection} disabled={busy}>Clear</button> : null}
      </div>

      <div className={styles.guardrails}>
        <span>Private R2 storage</span>
        <span>Short-lived signed upload</span>
        <span>Server-side validation</span>
      </div>

      {busy || stage === "queued" ? (
        <div className={styles.progressPanel} aria-live="polite">
          <div className={`${styles.progressStep} ${stageComplete(stage, "reserving") || stage === "reserving" ? styles.progressActive : ""}`}>
            <span>01</span><div><strong>Reserve secure slot</strong><small>Authorize this project and create a short-lived private upload target.</small></div>
          </div>
          <div className={`${styles.progressStep} ${stageComplete(stage, "uploading") || stage === "uploading" ? styles.progressActive : ""}`}>
            <span>02</span><div><strong>Upload to R2</strong><small>Send the file directly to private object storage using the signed request.</small></div>
          </div>
          <div className={`${styles.progressStep} ${stageComplete(stage, "queueing") || stage === "queueing" || stage === "queued" ? styles.progressActive : ""}`}>
            <span>03</span><div><strong>Queue validation</strong><small>Hand the immutable object to Genithm's deterministic sequence validator.</small></div>
          </div>
        </div>
      ) : null}

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="notice" role="status">{message}</div> : null}

      <button className="button primary" type="button" onClick={upload} disabled={busy || readiness !== "ready"}>
        {busy ? (stage === "reserving" ? "Reserving secure upload…" : stage === "uploading" ? "Uploading privately…" : "Queueing validation…") : "Upload FASTA securely"}
      </button>
      <div className="small">The browser only checks the basic FASTA envelope. Sequence type, record count, alphabet, hashes, and scientific readiness are determined authoritatively by the server-side validator.</div>
    </div>
  );
}
