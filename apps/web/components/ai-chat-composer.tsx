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
  kind: "sequence" | "image";
  uploadId?: string;
  dataUrl?: string;
  mimeType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  status: "checking" | "uploading" | "ready" | "error";
  error?: string;
};

const API_BASE = (process.env.NEXT_PUBLIC_GENITHM_API_URL || "http://localhost:8000").replace(/\/$/, "");
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_IMAGES = 4;
const ALLOWED_EXTENSIONS = new Set(["fa", "fasta", "fna", "faa", "fas", "txt"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

async function detectImageMime(file: File): Promise<NonNullable<Attachment["mimeType"]>> {
  if (file.size < 1) throw new Error("Image is empty.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images are limited to 8 MiB each.");

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  throw new Error("Use a valid JPEG, PNG, GIF, or WebP image.");
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
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
  const [dragActive, setDragActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [liveUserMessage, setLiveUserMessage] = useState<string | null>(null);
  const [liveAssistantMessage, setLiveAssistantMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busyUploading = attachments.some((attachment) => attachment.status === "checking" || attachment.status === "uploading");
  const readyAttachmentIds = attachments
    .filter((attachment) => attachment.kind === "sequence" && attachment.status === "ready" && attachment.uploadId)
    .map((attachment) => attachment.uploadId as string);
  const readyMediaAttachments = attachments
    .filter((attachment) => attachment.kind === "image" && attachment.status === "ready" && attachment.dataUrl && attachment.mimeType)
    .map((attachment) => ({
      filename: attachment.file.name.trim().slice(0, 255) || "image",
      mime_type: attachment.mimeType as string,
      data_url: attachment.dataUrl as string,
    }));

  async function uploadOne(file: File, key: string, kind: Attachment["kind"]) {
    try {
      if (kind === "image") {
        const mimeType = await detectImageMime(file);
        if (!IMAGE_TYPES.has(mimeType)) throw new Error("Unsupported image format.");
        const dataUrl = await readAsDataUrl(file);
        setAttachments((current) => current.map((item) => item.key === key
          ? { ...item, mimeType, dataUrl, status: "ready", error: undefined }
          : item));
        return;
      }

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
    const available = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const nextFiles = Array.from(files).slice(0, available);
    if (!nextFiles.length) return;

    setError(null);
    const existingImages = attachments.filter((attachment) => attachment.kind === "image").length;
    let imageSlots = Math.max(0, MAX_IMAGES - existingImages);
    const next: Attachment[] = [];

    for (const file of nextFiles) {
      const looksLikeImage = file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(file.name);
      if (looksLikeImage) {
        if (imageSlots <= 0) {
          setError(`You can attach up to ${MAX_IMAGES} images per message.`);
          continue;
        }
        imageSlots -= 1;
      }
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        kind: looksLikeImage ? "image" : "sequence",
        status: "checking",
      });
    }

    if (!next.length) return;
    setAttachments((current) => [...current, ...next]);

    for (const attachment of next) {
      void uploadOne(attachment.file, attachment.key, attachment.kind);
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
    if (!trimmed && readyAttachmentIds.length === 0 && readyMediaAttachments.length === 0) {
      setError("Type a message or attach a sequence file or image.");
      return;
    }

    setSending(true);
    setError(null);
    setLiveAssistantMessage("");
    setLiveUserMessage(trimmed || "Attached files for analysis.");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          conversation_id: conversationId,
          user_message: trimmed,
          attachment_upload_ids: readyAttachmentIds,
          media_attachments: readyMediaAttachments,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await responseError(response, "Genithm could not answer that message."));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resolvedConversationId: string | null = conversationId;
      let finalMessage = "";
      let terminalError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          let eventName = "message";
          let dataText = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) dataText += line.slice(5).trim();
          }
          if (!dataText) continue;

          let payload: {
            text?: string;
            message?: string;
            conversation_id?: string;
            error?: string;
          };
          try {
            payload = JSON.parse(dataText) as typeof payload;
          } catch {
            continue;
          }

          if (payload.conversation_id) resolvedConversationId = payload.conversation_id;

          if (eventName === "delta" && payload.text) {
            finalMessage += payload.text;
            setLiveAssistantMessage(finalMessage);
          } else if (eventName === "done") {
            if (payload.message && !finalMessage) {
              finalMessage = payload.message;
              setLiveAssistantMessage(finalMessage);
            }
          } else if (eventName === "error") {
            terminalError = payload.error || "Genithm could not answer that message.";
          }
        }
      }

      if (terminalError) throw new Error(terminalError);
      if (!resolvedConversationId) throw new Error("Genithm did not return a conversation.");

      setMessage("");
      setAttachments([]);

      if (!conversationId) {
        router.push(`/dashboard/ai/${resolvedConversationId}`);
      } else {
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Genithm could not answer that message.");
      if (!liveAssistantMessage) setLiveAssistantMessage(null);
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
          {liveAssistantMessage ? (
            <div className={styles.liveAssistant}>
              <span>Genithm</span>
              <p>{liveAssistantMessage}</p>
            </div>
          ) : sending ? (
            <div className={styles.liveAssistant}>
              <span>Genithm</span>
              <p className={styles.thinking}>Thinking…</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={`${styles.composer} ${dragActive ? styles.dragActive : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files);
        }}
      >
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
                {attachment.kind === "image" && attachment.dataUrl ? (
                  <img className={styles.attachmentPreview} src={attachment.dataUrl} alt="" />
                ) : null}
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
              accept=".fa,.fasta,.fna,.faa,.fas,.txt,text/plain,image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
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
              disabled={sending || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Attach sequence files or images"
              title="Attach FASTA files or images"
            >
              <span aria-hidden="true">＋</span>
              Attach
            </button>
            <span className={styles.hint}>FASTA/text or images · drag & drop supported</span>
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
