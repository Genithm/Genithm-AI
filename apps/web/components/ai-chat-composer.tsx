"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { LargeDataPanel } from "@/app/dashboard/data/large-data-panel";
import { ResearchFileSelector } from "@/components/research-file-selector";
import { inspectChatFile, isActualFasta, type ChatFileEvidence } from "@/lib/chat-file-intake";
import { identifyChatScienceFiles } from "@/lib/chat-science-client";
import styles from "./ai-chat-composer.module.css";

type ProjectOption = {
  id: string;
  name: string;
};

export type ResearchQuickAction = {
  icon: string;
  label: string;
  detail: string;
  prompt: string;
  needsWorkers?: boolean;
};

type Props = {
  projects: ProjectOption[];
  conversationId?: string | null;
  defaultProjectId?: string;
  placeholder?: string;
  suggestions?: string[];
  quickActions?: ResearchQuickAction[];
  scienceReady?: boolean;
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
  kind: "sequence" | "image" | "local";
  localEvidence?: ChatFileEvidence;
  localOnlyReason?: string;
  uploadId?: string;
  dataUrl?: string;
  mimeType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  status: "checking" | "uploading" | "validating" | "ready" | "error";
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

/** Keep complete research-file inspection off the UI thread when Web Workers exist. */
function inspectLocalAttachment(file: File): Promise<ChatFileEvidence> {
  if (typeof Worker === "undefined") return inspectChatFile(file);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../lib/chat-file-intake.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<{ report?: ChatFileEvidence; error?: string }>) => {
      worker.terminate();
      if (event.data.report) resolve(event.data.report);
      else reject(new Error(event.data.error || "Local file inspection failed."));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("Local file inspection worker failed.")); };
    worker.postMessage({ file });
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
  suggestions = [],
  quickActions = [],
  scienceReady = false,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [researchFilesOpen, setResearchFilesOpen] = useState(false);
  const [selectedResearchFiles, setSelectedResearchFiles] = useState<string[]>([]);
  const [shareTextExcerpts, setShareTextExcerpts] = useState(false);
  const [approvePrivateCompute, setApprovePrivateCompute] = useState(false);
  const [sending, setSending] = useState(false);
  const [liveUserMessage, setLiveUserMessage] = useState<string | null>(null);
  const [liveAssistantMessage, setLiveAssistantMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busyUploading = attachments.some((attachment) => ["checking", "uploading", "validating"].includes(attachment.status));
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

  const readyLocalEvidence = attachments
    .filter((attachment) => attachment.kind === "local" && attachment.status === "ready" && attachment.localEvidence)
    .map((attachment) => attachment.localEvidence as ChatFileEvidence);
  const shareableExcerptCount = readyLocalEvidence.filter((file) => file.excerpt !== undefined).length;

  async function uploadOne(file: File, key: string, kind: Attachment["kind"]) {
    try {
      if (kind === "image") {
        try {
          const mimeType = await detectImageMime(file);
          if (!IMAGE_TYPES.has(mimeType)) throw new Error("Unsupported image format.");
          const dataUrl = await readAsDataUrl(file);
          setAttachments((current) => current.map((item) => item.key === key
            ? { ...item, mimeType, dataUrl, status: "ready", error: undefined }
            : item));
        } catch {
          // A filename/MIME hint is not proof of an image. Preserve the
          // attachment as untrusted data instead of sending invalid pixels.
          const evidence = await inspectLocalAttachment(file);
          setAttachments((current) => current.map((item) => item.key === key
            ? { ...item, kind: "local", localEvidence: evidence, status: "ready", error: undefined }
            : item));
        }
        return;
      }

      // The paperclip is universal. Only a real FASTA goes to the dedicated
      // sequence endpoint; all other types stay local for bounded inspection.
      // This also accepts a .txt note without pretending it is FASTA.
      const sequenceCandidate = await isActualFasta(file) && file.size <= MAX_FILE_BYTES;
      if (!sequenceCandidate) {
        const evidence = await inspectLocalAttachment(file);
        setAttachments((current) => current.map((item) => item.key === key
          ? { ...item, kind: "local", localEvidence: evidence, status: "ready", error: undefined }
          : item));
        return;
      }
      setAttachments((current) => current.map((item) => item.key === key
        ? { ...item, kind: "sequence", status: "uploading", error: undefined }
        : item));
      try {
      await validateSequenceFile(file);

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

      const uploadResponse = await fetch(`${API_BASE}/api/v1/storage/sequence-uploads/${reservation.upload_id}/content`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...reservation.required_headers,
        },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(await responseError(uploadResponse, "Secure upload failed."));
      }

      const completionResponse = await fetch(`${API_BASE}/api/v1/storage/sequence-uploads/${reservation.upload_id}/complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!completionResponse.ok) {
        throw new Error(await responseError(completionResponse, "Could not queue sequence validation."));
      }

      setAttachments((current) => current.map((item) => item.key === key
        ? { ...item, uploadId: reservation.upload_id, status: "validating", error: undefined }
        : item));

      let validationError = "";
      for (let attempt = 0; attempt < 45; attempt += 1) {
        const { data: upload, error: uploadError } = await supabase
          .from("sequence_uploads")
          .select("status,processing_error")
          .eq("id", reservation.upload_id)
          .maybeSingle();

        if (uploadError) throw new Error("Could not check sequence validation.");
        if (upload?.status === "ready") {
          setAttachments((current) => current.map((item) => item.key === key
            ? { ...item, uploadId: reservation.upload_id, status: "ready", error: undefined }
            : item));
          return;
        }
        if (upload?.status === "rejected" || upload?.status === "error") {
          validationError = upload.processing_error || "Sequence validation failed.";
          break;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      throw new Error(validationError || "Sequence validation is still running. Please retry the upload.");
      } catch {
        // Chat-only Codespaces has no scientific sequence API. Do not reject
        // the file outright or claim it was saved: provide a local, unverified
        // preview and require working science services for later execution.
        const evidence = await inspectLocalAttachment(file);
        setAttachments((current) => current.map((item) => item.key === key
          ? { ...item, kind: "local", localEvidence: evidence, uploadId: undefined,
              localOnlyReason: "Sequence service unavailable; file stays in this browser.",
              status: "ready", error: undefined }
          : item));
        return;
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "File inspection failed.";
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
        kind: looksLikeImage ? "image" : "local",
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

  function resizeTextarea(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }

  function stopGeneration() {
    abortRef.current?.abort();
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
    if (!trimmed && readyAttachmentIds.length === 0 && readyMediaAttachments.length === 0 && readyLocalEvidence.length === 0) {
      setError("Type a message or attach a research file or image.");
      return;
    }

    if (selectedResearchFiles.length && !trimmed) {
      setError("Ask a question about the selected research-file evidence.");
      return;
    }
    const abortController = new AbortController();
    abortRef.current = abortController;
    setSending(true);
    setError(null);
    setLiveAssistantMessage("");
    setLiveUserMessage(trimmed || "Attached files for analysis.");

    try {
      // Scientific requests with real local files take the bounded science
      // execution path, not the LLM-only metadata inspection path. Researcher
      // opt-in is mandatory before ANY private bytes leave this browser.
      const attachedResearchFiles = attachments.filter(a => a.status === "ready" && a.kind !== "image").map(a => a.file);
      const proposedScience = await identifyChatScienceFiles(trimmed, attachedResearchFiles);
      if (proposedScience && "error" in proposedScience) throw new Error(proposedScience.error);
      let completedScienceRunId: string | undefined;
      if (proposedScience && "kind" in proposedScience) {
        if (!approvePrivateCompute) throw new Error("Approve temporary private-file scientific processing using the checkbox below your attachments. Files are removed from the compute worker after execution.");
        if (selectedResearchFiles.length || readyMediaAttachments.length)
          throw new Error("Send only the matching raw scientific file inputs for this analysis; select saved research files or images in a separate message.");
        const form = new FormData();
        form.set("kind", proposedScience.kind);
        form.set("project_id", projectId);
        form.set("approved_private_compute", "yes");
        for (const [role,file] of Object.entries(proposedScience.files)) form.set(role, file, file.name);
        setLiveAssistantMessage(`Analyzing the supplied ${proposedScience.kind} input files with the verified scientific engine…`);
        const scientificResponse = await fetch("/api/ai/science-results", {
          method: "POST", body: form, signal: abortController.signal,
        });
        if (!scientificResponse.ok) throw new Error(await responseError(scientificResponse,"Scientific file analysis failed."));
        const completed = await scientificResponse.json() as { run_id?: string };
        if (!completed.run_id) throw new Error("Scientific analysis finished without a verifiable result reference.");
        completedScienceRunId = completed.run_id;
        setLiveAssistantMessage("Analysis completed. Recording real results and download links in the conversation…");
      }
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        signal: abortController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          conversation_id: conversationId,
          user_message: trimmed,
          attachment_upload_ids: completedScienceRunId ? [] : readyAttachmentIds,
          research_file_ids: selectedResearchFiles,
          media_attachments: readyMediaAttachments,
          // Preserve the V55 browser-only privacy contract for ordinary
          // messages; computed research runs never forward the original files
          // or unverified local metrics to Gemini or Groq.
          ...(completedScienceRunId ? {
            local_file_evidence: [],
            share_local_text_excerpts: false,
          } : {
            local_file_evidence: readyLocalEvidence.map((file) => ({
              ...file,
              ...(shareTextExcerpts ? {} : { excerpt: undefined }),
            })),
            share_local_text_excerpts: shareTextExcerpts,
          }),
          completed_science_run_id: completedScienceRunId,
        }),
      });

      if (response.status === 401) {
        router.push("/login?message=" + encodeURIComponent("Your session expired. Please sign in again."));
        return;
      }
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
            status?: string;
            requires_confirmation?: boolean;
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
          } else if (eventName === "progress" && payload.text) {
            // Public-data scientific work is running, not a fabricated LLM answer.
            setLiveAssistantMessage(payload.text);
          } else if (eventName === "done") {
            if (payload.status === "science_completed" || payload.status === "science_failed" ||
                payload.status === "public_rice_gwas_completed" || payload.status === "public_rice_gwas_failed") {
              finalMessage = payload.message || "The public rice GWAS did not return a complete result.";
              setLiveAssistantMessage(finalMessage);
            } else if (payload.status === "awaiting_approval") {
              finalMessage = (payload.message || "Scientific action ready for your approval.") + "\nApprove the proposed analysis inside this conversation before it starts.";
              setLiveAssistantMessage(finalMessage);
            } else if (payload.message && !finalMessage) {
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
      setSelectedResearchFiles([]);
      setShareTextExcerpts(false);
      setApprovePrivateCompute(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      if (!conversationId) {
        router.push(`/dashboard/ai/${resolvedConversationId}`);
      } else {
        router.refresh();
      }
    } catch (caught) {
      const stopped = caught instanceof Error && caught.name === "AbortError";
      if (stopped) {
        setError(null);
        setLiveAssistantMessage((current) => current || "Generation stopped.");
      } else {
        setError(caught instanceof Error ? caught.message : "Genithm could not answer that message.");
        if (!liveAssistantMessage) setLiveAssistantMessage(null);
      }
    } finally {
      if (abortRef.current === abortController) abortRef.current = null;
      setSending(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      {quickActions.length ? (
        <section className={styles.quickStart} aria-label="Explore bioinformatics capabilities">
          <div className={styles.quickHeading}><span>EXPLORE SCIENTIFIC WORKFLOWS</span><span>Choose a starting point ↓</span></div>
          <div className={styles.quickGrid}>
            {quickActions.map((action) => {
              const unavailable = Boolean(action.needsWorkers && !scienceReady);
              return (
                <button
                  className={styles.quickCard}
                  type="button"
                  key={action.label}
                  disabled={unavailable || sending}
                  title={unavailable ? "This computation requires healthy scientific workers" : action.detail}
                  onClick={() => { setMessage(action.prompt); textareaRef.current?.focus(); }}
                >
                  <span className={styles.quickIcon} aria-hidden="true">{action.icon}</span>
                  <span className={styles.quickText}><strong>{action.label}</strong><small>{action.detail}</small></span>
                  {unavailable ? <span className={styles.quickOffline}>Offline</span> : <span className={styles.quickArrow} aria-hidden="true">↗</span>}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      {suggestions.length ? <div className={styles.suggestions} aria-label="Example bioinformatics requests">{suggestions.map((suggestion) => <button key={suggestion} type="button" className={styles.suggestion} onClick={() => { setMessage(suggestion); textareaRef.current?.focus(); }}>{suggestion}</button>)}</div> : null}
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
        {projects.length === 1 ? (
          <div className={styles.projectRow}>
            <span className={styles.projectIndicator} aria-hidden="true">◉</span>
            <span>Research project: <strong>{projects[0].name}</strong></span>
          </div>
        ) : null}
        {projects.length > 1 ? (
          <div className={styles.projectRow}>
            <span>Project</span>
            <select value={projectId} onChange={(event) => {
              setProjectId(event.target.value);
              setAttachments([]);
              setSelectedResearchFiles([]);
              setShareTextExcerpts(false);
              setApprovePrivateCompute(false);
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
                        : attachment.status === "validating"
                          ? "validating"
                          : attachment.status === "ready"
                            ? attachment.kind === "local"
                              ? `${attachment.localEvidence?.format.toUpperCase() || "FILE"} · ${attachment.localEvidence?.inspection === "complete" ? "fully inspected locally" : attachment.localEvidence?.inspection === "invalid" ? "invalid structure; not analyzed" : attachment.localEvidence?.inspection === "header_only" ? "header only" : "opaque metadata only"}`
                              : "attached to sequence storage"
                            : attachment.error || "failed"}
                  </span>
                  {attachment.localOnlyReason ? <span>{attachment.localOnlyReason}</span> : null}
                  {attachment.kind === "local" && attachment.localEvidence ? <details>
                    <summary>Local file inspection report</summary>
                    <p className="genithm-note">{attachment.localEvidence.inspection === "complete"
                      ? "Calculated from the entire file (browser-reported; not server verified)."
                      : attachment.localEvidence.inspection === "invalid"
                        ? "The format validator rejected its structure. File is still attached as local metadata; no scientific counts are asserted."
                        : "Only the file type/header was inspected. No complete scientific result exists."}</p>
                    {Object.entries(attachment.localEvidence.metrics).map(([name, value]) =>
                      <span key={name}>{name.replaceAll("_", " ")}: {value.toLocaleString()} · </span>)}
                    {attachment.localEvidence.sha256 ? <p className="genithm-note">Source SHA-256 (browser): {attachment.localEvidence.sha256}</p> : null}
                  </details> : null}
                </div>
                <button type="button" onClick={() => removeAttachment(attachment.key)} disabled={sending || attachment.status === "uploading" || attachment.status === "validating"} aria-label={`Remove ${attachment.file.name}`}>×</button>
              </div>
            ))}
          </div>
        ) : null}

        {attachments.filter(a => a.status === "ready" && a.kind !== "image").length >= 1 ? <label className="genithm-note" style={{display:"flex",gap:8,alignItems:"flex-start",padding:"8px 0"}}>
          <input type="checkbox" checked={approvePrivateCompute} disabled={sending}
            onChange={event=>setApprovePrivateCompute(event.target.checked)} />
          Authorize Genithm to temporarily transfer the attached files to the private Codespaces scientific worker if I request GWAS, RNA expression, pathway enrichment, FASTQ read QC, VCF variant QC, or FASTA statistics. Original inputs are deleted after calculation; real results remain downloadable for 48 hours. GWAS without numeric ancestry covariates is explicitly acknowledged as unadjusted exploratory association, not population-corrected discovery. Without this option, files stay as local previews.
        </label> : null}
        {shareableExcerptCount > 0 ? <label className="genithm-note" style={{display:"flex",gap:8,alignItems:"flex-start"}}>
          <input type="checkbox" checked={shareTextExcerpts} disabled={sending}
            onChange={(event) => setShareTextExcerpts(event.target.checked)} />
          Share up to 1,500 characters from each locally inspected text/table document with Gemini or Groq for this message.
          Original files stay in this browser; without this option only filenames, file sizes, formats, counts and checksums are shared.
        </label> : null}
        {readyLocalEvidence.length > 0 ? <p className="genithm-note" role="status">
          {readyLocalEvidence.length} research file(s) inspected locally. Complete counts are reported only for fully parsed formats.
          Binary, compressed, proprietary or large files are accepted as metadata, not misrepresented as analyzed.
          Supported VCF + phenotype, count matrix + design, GMT + gene lists, FASTQ (single/paired), VCF QC and FASTA analysis can execute directly in chat after approval. Other formats remain honest previews; use Research files for persistent storage.
        </p> : null}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            resizeTextarea(event.currentTarget);
          }}
          maxLength={8000}
          aria-label={conversationId ? "Reply to Genithm" : "Message Genithm"}
          placeholder={placeholder}
          disabled={sending}
          onPaste={(event) => {
            const imageFiles = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (imageFiles.length) {
              if (!event.clipboardData.getData("text")) event.preventDefault();
              void addFiles(imageFiles);
            }
          }}
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
              aria-label="Attach research files or images"
              title="Attach files of any format for local inspection; supported FASTA can be stored as a sequence"
            >
              <span aria-hidden="true">＋</span>
              Attach
            </button>
            <Link href="/dashboard/gwas" className={styles.attachButton} title="Open real local genome-wide association analysis">GWAS Lab</Link>
            <Link href="/dashboard/expression" className={styles.attachButton} title="Analyze RNA-seq count matrices and sample QC with real local statistics">RNA Expression</Link>
            <Link href="/dashboard/pathways" className={styles.attachButton} title="Test actual gene-set over-representation on selected and measured genes">Pathways</Link>
            <button className={styles.attachButton} type="button" disabled={!projectId || sending} aria-expanded={researchFilesOpen} aria-controls={researchFilesOpen ? "genithm-chat-research-files" : undefined} onClick={() => setResearchFilesOpen(value => !value)}>Research files</button>
            <span className={styles.hint}>FASTA, FASTQ, VCF, tables, documents, archives and more · drag &amp; drop</span>
          </div>
          <button
            className="button primary"
            type="button"
            onClick={() => sending ? stopGeneration() : void send()}
            disabled={!sending && busyUploading}
          >
            <span aria-hidden="true">{sending ? "■" : "↑"}</span> {sending ? "Stop" : "Send"}
          </button>
        </div>
      </div>

      {researchFilesOpen && projectId ? <section id="genithm-chat-research-files" aria-label="Project files in chat">
        <p className="genithm-note">Upload any research file or folder to this project. Stored files are not automatically sent to the language model; explicitly select verified results below. Switching projects or closing this panel pauses browser transfers; completed uploads remain in Data.</p>
        <ResearchFileSelector projectId={projectId} selected={selectedResearchFiles} onChange={setSelectedResearchFiles} disabled={sending || busyUploading} />
        <LargeDataPanel key={projectId} projects={projects.filter(project => project.id === projectId)} />
      </section> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
    </div>
  );
}
