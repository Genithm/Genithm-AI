"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import styles from "./ai-chat-composer.module.css";

type ProjectOption = {
  id: string;
  name: string;
};

type Props = {
  projects: ProjectOption[];
  conversationId?: string | null;
  defaultProjectId?: string;
  placeholder?: string;
};

type ReservationResponse = {
  upload_id: string;
  upload_url: string;
  method: "PUT";
  required_headers: Record<string, string>;
};

type Attachment = {
  key: string;
  file: File;
  uploadId?: string;
  status: "checking" | "uploading" | "ready" | "error";
  error?: string;
};

const API_BASE = (process.env.NEXT_PUBLIC_GENITHM_API_URL || "http://localhost:8000").replace(/\/$/, "");
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["fa", "fasta", "fna", "faa", "fas", "txt"]);

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function validateSequenceFile(file: File) {
  if (file.size < 1) throw new Error("File is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Files are limited to 50 MiB.");
  const ext = extensionOf(file.name);
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Use FASTA/text files: .fasta, .fa, .fna, .faa, .fas, or .txt.");
  }
  const prefix = await file.slice(0, 8192).text();
  const normalized = prefix.replace(/^\uFEFF/, "").trimStart();
  if (!normalized.startsWith(">")) throw new Error("This file does not look like FASTA.");
  if (normalized.includes("\u0000")) throw new Error("Binary files are not accepted.");
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.detail === "string") return payload.detail;
    if (payload && typeof payload.error === "string") return payload.error;
  } catch {
    // Stable fallback below.
  }
  return fallback;
}

export function AiChatComposer({
  projects,
  conversationId = null,
  defaultProjectId,
  placeholder = "Message Genithm…",
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [liveUserMessage, setLiveUserMessage] = useState<string | null>(null);
  const [liveAssistantMessage, setLiveAssistantMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busyUploading = attachments.some((attachment) => attachment.status === "checking" || attachment.status === "uploading");
  const readyAttachmentIds = attachments
    .filter((attachment) => attachment.status === "ready" && attachment.uploadId)
    .map((attachment) => attachment.uploadId as string);

  async function uploadOne(file: File, key: string) {
    try {
      await validateSequenceFile(file);
      setAttachments((current) => current.map((item) => item.key === key ? { ...item, status: "uploading", error: undefined } : item));

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) throw new Error("Your session expired. Sign in again.");

      const reservationResponse = await fetch(`${API_BASE}/api/v1/storage/sequence-uploads`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: projectId,
          original_filename: file.name.trim().slice(0, 255) || "sequence.fasta",
          file_size_bytes: file.size,
          content_type: file.type || "application/octet-stream",
        }),
      });
      if (!reservationResponse.ok) {
        throw new Error(await responseError(reservationResponse, "Could not reserve secure upload."));
      }
      const reservation = (await reservationResponse.json()) as ReservationResponse;

      const uploadResponse = await fetch(reservation.upload_url, {
        method: reservation.method,
        headers: reservation.required_headers,
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Secure upload failed.");

      const completionResponse = await fetch(`${API_BASE}/api/v1/storage/sequence-uploads/${reservation.upload_id}/complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!completionResponse.ok) {
        throw new Error(await responseError(completionResponse, "Could not queue sequence validation."));
      }

      setAttachments((current) => current.map((item) => item.key === key
        ? { ...item, uploadId: reservation.upload_id, status: "ready", error: undefined }
        : item));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Upload failed.";
      setAttachments((current) => current.map((item) => item.key === key
        ? { ...item, status: "error", error: message }
        : item));
    }
  }

  async function addFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files).slice(0, Math.max(0, 10 - attachments.length));
    if (!nextFiles.length) return;

    setError(null);
    const next = nextFiles.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      status: "checking" as const,
    }));
    setAttachments((current) => [...current, ...next]);

    for (const attachment of next) {
      void uploadOne(attachment.file, attachment.key);
    }
  }

  function removeAttachment(key: string) {
    if (sending) return;
    setAttachments((current) => current.filter((item) => item.key !== key));
  }

  async function send() {
    const trimmed = message.trim();
    if (!projectId) {
      setError("Choose a project first.");
      return;
    }
    if (busyUploading) {
      setError("Finish uploading attachments before sending.");
      return;
    }
    if (attachments.some((attachment) => attachment.status === "error")) {
      setError("Remove failed attachments before sending.");
      return;
    }
    if (!trimmed && readyAttachmentIds.length === 0) {
      setError("Type a message or attach a sequence file.");
      return;
    }

    setSending(true);
    setError(null);
    setLiveAssistantMessage(null);
    setLiveUserMessage(trimmed || "Attached biological data for analysis.");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          conversation_id: conversationId,
          user_message: trimmed,
          attachment_upload_ids: readyAttachmentIds,
        }),
      });
      const payload = await response.json() as {
        conversation_id?: string;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.conversation_id) {
        throw new Error(payload.error || "Genithm could not answer that message.");
      }

      setLiveAssistantMessage(payload.message || null);
      setMessage("");
      setAttachments([]);

      if (!conversationId) {
        router.push(`/dashboard/ai/${payload.conversation_id}`);
      } else {
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Genithm could not answer that message.");
      setLiveAssistantMessage(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      {liveUserMessage ? (
        <div className={styles.liveTurn}>
          <div className={styles.liveUser}>
            <span>You</span>
            <p>{liveUserMessage}</p>
          </div>
          {sending ? (
            <div className={styles.liveAssistant}>
              <span>Genithm</span>
              <p className={styles.thinking}>Thinking…</p>
            </div>
          ) : liveAssistantMessage ? (
            <div className={styles.liveAssistant}>
              <span>Genithm</span>
              <p>{liveAssistantMessage}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.composer}>
        {projects.length > 1 ? (
          <div className={styles.projectRow}>
            <span>Project</span>
            <select value={projectId} onChange={(event) => {
              setProjectId(event.target.value);
              setAttachments([]);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }} disabled={sending || busyUploading}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
        ) : null}

        {attachments.length ? (
          <div className={styles.attachments}>
            {attachments.map((attachment) => (
              <div className={styles.attachment} key={attachment.key}>
                <div>
                  <strong>{attachment.file.name}</strong>
                  <span>
                    {formatFileSize(attachment.file.size)} · {attachment.status === "checking"
                      ? "checking"
                      : attachment.status === "uploading"
                        ? "uploading"
                        : attachment.status === "ready"
                          ? "attached"
                          : attachment.error || "failed"}
                  </span>
                </div>
                <button type="button" onClick={() => removeAttachment(attachment.key)} disabled={sending || attachment.status === "uploading"} aria-label={`Remove ${attachment.file.name}`}>×</button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={8000}
          aria-label={conversationId ? "Reply to Genithm" : "Message Genithm"}
          placeholder={placeholder}
          disabled={sending}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />

        <div className={styles.footer}>
          <div className={styles.tools}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".fa,.fasta,.fna,.faa,.fas,.txt,text/plain"
              className={styles.fileInput}
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <button
              className={styles.attachButton}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || attachments.length >= 10}
              aria-label="Attach biological sequence files"
              title="Attach FASTA files"
            >
              <span aria-hidden="true">＋</span>
              Attach
            </button>
            <span className={styles.hint}>FASTA/text · up to 10 files · 50 MiB each</span>
          </div>
          <button className="button primary" type="button" onClick={() => void send()} disabled={sending || busyUploading}>
            {sending ? "Thinking…" : "Send"}
          </button>
        </div>
      </div>

      {error ? <div className="error" role="alert">{error}</div> : null}
    </div>
  );
}
