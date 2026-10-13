"use client";

import { useRef, useState, type FormEvent } from "react";
import styles from "./chat-first-lab.module.css";

type Operation =
  | "orf_scan"
  | "six_frame_translation"
  | "motif_scan"
  | "reverse_complement"
  | "composition_profile"
  | "pairwise_global"
  | "pairwise_local"
  | "comparison_matrix"
  | "msa_conservation"
  | "msa_phylogeny";

type ScientificOutput = {
  mode?: string;
  persistence?: string;
  input_sha256?: string;
  tool?: { id?: string; version?: string };
  summary?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
};

type Turn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  output?: ScientificOutput;
};

const EXAMPLE = ">sample\nATGAAATAA";
const IDEAS = [
  "Find complete ORFs",
  "Translate all six reading frames",
  "Calculate GC content and sequence quality",
  "Find motif AAA",
  "Compute the reverse complement",
];
const SAFE_SEQUENCE = /^[ACGTUNRYSWKMBDHV\s]+$/i;
const MAX_CHARS = 5500;
const MAX_TURNS = 60;

function normalSource(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_CHARS) return null;
  if (trimmed.startsWith(">")) {
    const lines = trimmed.split(/\r?\n/);
    let hasBases = false;
    let count = 0;
    for (const line of lines) {
      if (line.startsWith(">")) {
        if (line.length < 2 || line.length > 90) return null;
        count += 1;
      } else if (line.trim()) {
        if (!SAFE_SEQUENCE.test(line)) return null;
        hasBases = true;
      }
    }
    return hasBases && count >= 1 && count <= 8 ? trimmed : null;
  }
  return SAFE_SEQUENCE.test(trimmed) && trimmed.replace(/\s/g, "").length >= 2 ? trimmed : null;
}

function requestedOperation(text: string, source: string): { operation: Operation; motif: string | null } | null {
  const lower = text.toLowerCase();
  if (/phylogen|evolutionary tree|build.*tree|tree.*sequence/.test(lower)) return { operation: "msa_phylogeny", motif: null };
  if (/multiple.*align|\bmsa\b|conservation/.test(lower)) return { operation: "msa_conservation", motif: null };
  if (/identity matrix|compare (?:all|three|four|several)/.test(lower)) return { operation: "comparison_matrix", motif: null };
  if (/local align|smith.waterman/.test(lower)) return { operation: "pairwise_local", motif: null };
  if (/pairwise|global align|needleman|compare (?:two|both)|compare.*sequences/.test(lower)) {
    return { operation: "pairwise_global", motif: null };
  }
  if (/reverse complement/.test(lower)) return { operation: "reverse_complement", motif: null };
  if (/six.frame|six frame|translate|translation|reading frame/.test(lower)) {
    return { operation: "six_frame_translation", motif: null };
  }
  if (/\borf\b|open reading frame|coding region/.test(lower)) return { operation: "orf_scan", motif: null };
  if (/motif|nucleotide pattern/.test(lower)) {
    const found = text.toUpperCase().match(/\b(?:MOTIF|PATTERN)\s+([ACGTRYSWKMBDHVNU]{2,32})\b/);
    return { operation: "motif_scan", motif: found ? found[1] : null };
  }
  if (/\bgc\b|composition|quality|statistics|analy[sz]e|profile/.test(lower)) {
    return { operation: "composition_profile", motif: null };
  }
  // An uploaded sequence by itself is data, not consent to run compute.
  void source;
  return null;
}

function preview(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.slice(0, 100);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return "";
}

function describe(output: ScientificOutput, operation: Operation): string {
  const summary = output.summary ?? {};
  const label = operation.replaceAll("_", " ");
  const facts = Object.entries(summary)
    .filter(([key, value]) => key !== "operation" && key !== "job_type" && (typeof value === "number" || typeof value === "string"))
    .slice(0, 6)
    .map(([key, value]) => key.replaceAll("_", " ") + ": " + preview(value));
  return "Completed " + label + " with the local scientific engine. " +
    (facts.length ? "Measured results: " + facts.join("; ") + "." : "See the result details below.") +
    " This is a local exploratory result, not a validated production research report.";
}

function resultItems(output: ScientificOutput) {
  return Object.entries(output.result ?? {})
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || Array.isArray(value))
    .slice(0, 8);
}

/**
 * The Codespaces chat is deliberately NOT a language model. It is an offline,
 * deterministic chat-shaped interface to the existing verified local science API.
 * Production AI chat remains authenticated and separately policy-gated.
 */
export function ChatFirstLab() {
  const [turns, setTurns] = useState<Turn[]>([{
    id: 0,
    role: "assistant",
    text: "Welcome to the Genithm local research chat. Tell me what you want to study, then paste or attach DNA/RNA FASTA here. I will ask for missing inputs and show real analysis results in this conversation. Try: Find complete ORFs.",
  }]);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [sequenceType, setSequenceType] = useState<"dna" | "rna">("dna");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const idRef = useRef(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function push(role: Turn["role"], body: string, more: Partial<Turn> = {}) {
    const id = idRef.current++;
    setTurns((existing) => [...existing.slice(-(MAX_TURNS - 1)), { id, role, text: body, ...more }]);
    window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    return id;
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    if (file.size < 1 || file.size > MAX_CHARS) {
      setNotice("This local chat accepts a single DNA/RNA text or FASTA file up to 5,500 bytes.");
      return;
    }
    const contents = await file.text();
    const valid = normalSource(contents);
    if (!valid) {
      setNotice("Only DNA/RNA nucleotides or 1-8 named FASTA records are supported in this local demo.");
      return;
    }
    setSource(valid);
    setNotice("Attached " + file.name + " (" + valid.length + " characters). Ask for an analysis in the message box.");
    push("user", "Attached " + file.name + " as " + sequenceType.toUpperCase() + " research input.");
    push("assistant", "Sequence input received in this local session. Which analysis should I run? You can request ORFs, translation, GC quality, pairwise comparison, MSA, or phylogeny.");
  }

  async function send(event?: FormEvent<HTMLFormElement>, suggested?: string) {
    event?.preventDefault();
    if (busy) return;
    const requestText = (suggested ?? text).trim();
    if (!requestText) return;
    setText("");
    setNotice("");
    push("user", requestText.length > 600 ? requestText.slice(0, 600) + "… [sequence input shortened in chat]" : requestText);

    const supplied = normalSource(requestText);
    const inlineFastaIndex = requestText.indexOf(">");
    const inlineFasta = inlineFastaIndex >= 0 ? normalSource(requestText.slice(inlineFastaIndex)) : null;
    const chosenSource = supplied ?? inlineFasta ?? source;
    if (supplied || inlineFasta) setSource(chosenSource);
    const action = requestedOperation(requestText, chosenSource);
    if (!action) {
      push("assistant", supplied || inlineFasta
        ? "Your nucleotide data is ready. What should I do with it? Try 'Find ORFs', 'GC content', or 'six-frame translation'. I will not run scientific computations until you request one."
        : "I can analyze DNA/RNA sequences using real local algorithms. Tell me which analysis you need and paste or attach the sequences in this chat. This Codespaces demo uses rule-based intent detection, not a connected AI model.");
      return;
    }
    if (!chosenSource) {
      push("assistant", "I can run " + action.operation.replaceAll("_", " ") + ". Please paste a DNA/RNA sequence or named FASTA records here, or use the attachment button.");
      return;
    }
    if (action.operation === "motif_scan" && !action.motif) {
      push("assistant", "Which nucleotide motif should I search for? For example, reply 'Find motif AAA'.");
      return;
    }

    const count = chosenSource.startsWith(">") ? chosenSource.split(/\r?\n/).filter((line) => line.startsWith(">")).length : 1;
    if ((action.operation === "pairwise_global" || action.operation === "pairwise_local") && count !== 2) {
      push("assistant", "For pairwise alignment, please attach exactly two named FASTA records in a single file, then ask me to compare them.");
      return;
    }
    if (action.operation === "comparison_matrix" && (count < 3 || count > 6)) {
      push("assistant", "For an identity matrix, I need 3–6 named FASTA records in one upload.");
      return;
    }
    if ((action.operation === "msa_conservation" || action.operation === "msa_phylogeny") && (count < 3 || count > 8)) {
      push("assistant", "For MSA or phylogeny, please provide 3–8 named DNA/RNA FASTA records in one upload.");
      return;
    }
    if (count !== 1 && ["orf_scan", "six_frame_translation", "motif_scan", "reverse_complement", "composition_profile"].includes(action.operation)) {
      push("assistant", "That operation requires one nucleotide sequence. Please attach a single-record FASTA or paste the sequence.");
      return;
    }

    setBusy(true);
    const pendingId = push("assistant", "Running " + action.operation.replaceAll("_", " ") + " using the local scientific engine…", { pending: true });
    try {
      const response = await fetch("/api/dev-science", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          sequence: chosenSource,
          sequence_type: sequenceType,
          operation: action.operation,
          motif: action.operation === "motif_scan" ? action.motif : null,
          min_aa: action.operation === "orf_scan" ? 2 : 30,
        }),
      });
      const output = await response.json() as ScientificOutput;
      if (!response.ok) throw new Error(output.error || "Local analysis failed.");
      if (output.mode !== "local-development-only" || !output.summary || !output.result || !output.input_sha256) {
        throw new Error("Scientific engine returned an incomplete result.");
      }
      setTurns((existing) => existing.map((turn) => turn.id === pendingId
        ? { ...turn, pending: false, text: describe(output, action.operation), output }
        : turn));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to reach scientific engine.";
      setTurns((existing) => existing.map((turn) => turn.id === pendingId
        ? { ...turn, pending: false, text: "I could not complete that scientific run: " + message }
        : turn));
    } finally {
      setBusy(false);
    }
  }

  function exportResult(output: ScientificOutput) {
    const json = JSON.stringify(output, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "genithm-local-chat-result.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.shell} id="chat-first-lab" aria-labelledby="chat-first-heading">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>GENITHM / CHAT-FIRST SCIENCE</div>
          <h2 id="chat-first-heading">Your research, one conversation.</h2>
          <p>Ask, attach data, run local analysis, and get the results right here. No workflow forms.</p>
        </div>
        <span className={styles.mode}>LOCAL • NO AI PROVIDER</span>
      </header>

      <div className={styles.surface}>
        <div className={styles.conversation} role="log" aria-live="polite" aria-label="Scientific chat">
          {turns.map((turn) => (
            <article key={turn.id} className={turn.role === "user" ? styles.user : styles.assistant}>
              <span className={styles.role}>{turn.role === "user" ? "You" : "Genithm"}</span>
              <p>{turn.text}</p>
              {turn.output ? (
                <div className={styles.output}>
                  <strong>Scientific output</strong>
                  <div className={styles.facts}>
                    {Object.entries(turn.output.summary ?? {}).filter(([, value]) =>
                      typeof value === "number" || typeof value === "string").slice(0, 10)
                      .map(([key, value]) => (
                        <div key={key}><span>{key.replaceAll("_", " ")}</span><b>{preview(value)}</b></div>
                      ))}
                  </div>
                  {resultItems(turn.output).map(([key, value]) => (
                    <details className={styles.detail} key={key}>
                      <summary>{key.replaceAll("_", " ")} {Array.isArray(value) ? "(" + value.length + ")" : ""}</summary>
                      <pre>{JSON.stringify(value, null, 2).slice(0, 5500)}</pre>
                    </details>
                  ))}
                  <div className={styles.evidence}>
                    <span>Tool: {turn.output.tool?.id ?? "local scientific engine"} ({turn.output.tool?.version ?? "unknown"})</span>
                    <span>Input SHA-256: {turn.output.input_sha256}</span>
                    <span>Local only; not a signed research artifact</span>
                  </div>
                  <button type="button" className={styles.export} onClick={() => exportResult(turn.output as ScientificOutput)}>Download complete JSON result</button>
                </div>
              ) : null}
              {turn.pending ? <span className={styles.pending}>Computing…</span> : null}
            </article>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className={styles.suggestions} aria-label="Suggested analyses">
          {IDEAS.map((idea) => (
            <button key={idea} type="button" disabled={busy} onClick={() => void send(undefined, idea)}>{idea}</button>
          ))}
        </div>

        <form onSubmit={(event) => void send(event)} className={styles.composer}>
          <div className={styles.controls}>
            <label htmlFor="genithm-chat-sequence-type">Sequence</label>
            <select id="genithm-chat-sequence-type" value={sequenceType} disabled={busy} onChange={(event) => setSequenceType(event.target.value as "dna" | "rna")}>
              <option value="dna">DNA</option>
              <option value="rna">RNA</option>
            </select>
            {source ? <span className={styles.attached}>Input ready: {source.length} characters</span> : <span>No sequence provided yet</span>}
            {source ? <button type="button" onClick={() => { setSource(""); setNotice("Input cleared."); }} disabled={busy}>Clear input</button> : null}
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_CHARS + 500}
            placeholder={"Ask Genithm to find ORFs, or paste DNA/FASTA here…"}
            aria-label="Ask Genithm and provide sequence data"
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className={styles.composerFooter}>
            <input ref={fileRef} className={styles.hidden} type="file" accept=".fasta,.fa,.fna,.txt,text/plain" onChange={(event) => {
              void attach(event.target.files?.[0]);
              event.currentTarget.value = "";
            }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>+ Attach DNA/RNA FASTA</button>
            <button type="button" onClick={() => { setSource(EXAMPLE); setNotice("Loaded example ATGAAATAA. Ask for an analysis."); }} disabled={busy}>Use sample</button>
            <button type="submit" className={styles.send} disabled={busy || !text.trim()}>{busy ? "Running…" : "Send ↗"}</button>
          </div>
        </form>
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      </div>
      <p className={styles.disclaimer}>This Codespaces demonstration is a deterministic chat interface to real local Python algorithms. It does not perform open-ended AI reasoning, call NCBI, create projects, submit cloud jobs, or retain research data.</p>
    </section>
  );
}
