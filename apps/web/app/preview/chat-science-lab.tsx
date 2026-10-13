"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import styles from "./chat-science-lab.module.css";

type Method = "orf_scan" | "six_frame_translation" | "motif_scan" | "reverse_complement" | "composition_profile";
type Entry = { id: number; speaker: "researcher" | "genithm"; text: string; result?: Record<string, unknown> };
type Result = { summary?: Record<string, unknown>; result?: Record<string, unknown>; input_sha256?: string; tool?: { id?: string; version?: string }; error?: string };
const examples = [
  "Find ORFs in ATGAAATAA",
  "Translate ATGAAATAA in six reading frames",
  "Find motif AAA in ATGAAATAA",
  "Reverse complement ATGAAATAA",
  "Calculate GC content for ACGCGTT",
] as const;

function methodFor(text: string): Method | null {
  const question = text.toLowerCase();
  if (/\b(reverse complement|revcomp)\b/.test(question)) return "reverse_complement";
  if (/\b(motif|pattern|search for)\b/.test(question)) return "motif_scan";
  if (/\b(orf|open reading frame)\b/.test(question)) return "orf_scan";
  if (/\b(translate|translation|reading frame)\b/.test(question)) return "six_frame_translation";
  if (/\b(gc|composition|quality|nucleotide statistics)\b/.test(question)) return "composition_profile";
  return null;
}
function inputFor(text: string, attached: string): string | null {
  if (attached.trim()) return attached.trim();
  const fasta = text.match(/>[^<\r\n]{1,100}\r?\n(?:[ACGTUNRYKMSWBDHV\s]{3,}\r?\n?)+/i);
  if (fasta) return fasta[0].trim();
  // Only an unambiguous standalone run of DNA/RNA bases is accepted.
  const candidates = text.toUpperCase().match(/\b[ACGTU]{5,5000}\b/g) ?? [];
  if (candidates.length !== 1) return null;
  return candidates[0];
}
function safeMetrics(data: Result) {
  const summary = data.summary ?? {};
  return Object.entries(summary).filter(([key, value]) =>
    !/sequence|raw|fasta|token|secret/i.test(key) &&
    (typeof value === "number" || typeof value === "boolean" ||
     (typeof value === "string" && value.length <= 140))
  ).slice(0, 12);
}
function resultDetail(data: Result, method: Method) {
  const result = data.result ?? {};
  if (method === "reverse_complement" && typeof result.reverse_complement === "string")
    return "Reverse complement: " + result.reverse_complement.slice(0, 500);
  if (method === "orf_scan" && Array.isArray(result.orfs))
    return "ORFs: " + JSON.stringify(result.orfs.slice(0, 4));
  if (method === "six_frame_translation" && Array.isArray(result.frames))
    return "Frames: " + JSON.stringify(result.frames.slice(0, 6));
  if (method === "motif_scan" && Array.isArray(result.hits))
    return "Motif hits: " + JSON.stringify(result.hits.slice(0, 12));
  return "";
}

export function ChatScienceLab() {
  const [entries, setEntries] = useState<Entry[]>([{
    id: 0, speaker: "genithm",
    text: "Describe a DNA/RNA analysis in one message and paste the sequence, or attach a FASTA file. I can run ORF detection, translation, motif search, reverse complement and GC composition. Results appear here. This local demonstration uses deterministic Python algorithms, not an AI model.",
  }]);
  const [prompt, setPrompt] = useState("");
  const [attached, setAttached] = useState("");
  const [filename, setFilename] = useState("");
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(1);

  function append(speaker: Entry["speaker"], text: string, result?: Record<string, unknown>) {
    const id = idRef.current++;
    setEntries((old) => [...old, { id, speaker, text, result }]);
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 7000 || !/\.(fa|fasta|fna|fas|txt)$/i.test(file.name)) {
      append("genithm", "Attach one plain-text FASTA file under 7 KB (.fa, .fasta, .fna, .fas, .txt). The maximum analysis input is 5,000 bases.");
      return;
    }
    const content = await file.text();
    if (!content.trimStart().startsWith(">") || content.includes("\u0000")) {
      append("genithm", "That file is not a valid plain-text FASTA record.");
      return;
    }
    setAttached(content);
    setFilename(file.name);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const text = prompt.trim();
    if (!text) return;
    append("researcher", text + (filename ? " [Attached: " + filename + "]" : ""));
    setPrompt("");
    const method = methodFor(text);
    const sequence = inputFor(text, attached);
    if (!method) {
      append("genithm", "What analysis should I run? Please ask for ORFs, six-frame translation, motif search, reverse complement or GC composition. For example: Find ORFs in ATGAAATAA.");
      return;
    }
    if (!sequence) {
      append("genithm", "Please include a DNA/RNA sequence of at least 5 bases in your next message, or use Attach FASTA. No workflow page is needed.");
      return;
    }
    const motif = method === "motif_scan" ? text.match(/\bmotif\s+([ACGTURYSWKMBDHVN]{2,30})\b/i)?.[1]?.toUpperCase() : undefined;
    if (method === "motif_scan" && !motif) {
      append("genithm", "Which IUPAC motif should I search for? Example: Find motif AAA in ATGAAATAA.");
      return;
    }
    const hasU = /U/i.test(sequence), hasT = /T/i.test(sequence);
    if (hasU && hasT) {
      append("genithm", "Your input mixes U and T; please provide either a DNA or an RNA sequence.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/dev-science", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequence, sequence_type: hasU ? "rna" : "dna",
          operation: method, motif: motif ?? null,
          min_aa: method === "orf_scan" ? 2 : 30,
        }),
      });
      const data = await response.json() as Result;
      if (!response.ok) {
        append("genithm", data.error || "The local scientific engine rejected this analysis.");
        return;
      }
      append("genithm", "Analysis complete. These values come from the local scientific engine, not generated guesses. " +
        resultDetail(data, method) + "\nInput SHA-256: " + (data.input_sha256 ?? "unavailable"), data as Record<string, unknown>);
      setAttached("");
      setFilename("");
    } catch {
      append("genithm", "The local science engine is unavailable. In Codespaces Terminal, run: bash .devcontainer/start.sh");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.shell} aria-label="Chat-first scientific workbench">
      <div className={styles.title}>
        <span className={styles.eyebrow}>GENITHM / CHAT-FIRST SCIENCE</span>
        <h2>Your research starts in chat</h2>
        <p>Ask, attach data and receive actual scientific output here. No manual workflow navigation.</p>
      </div>
      <div className={styles.thread} role="log" aria-live="polite" aria-relevant="additions">
        {entries.map((entry) => (
          <div className={entry.speaker === "researcher" ? styles.user : styles.assistant} key={entry.id}>
            <strong>{entry.speaker === "researcher" ? "You" : "Genithm"}</strong>
            <p>{entry.text}</p>
            {entry.result ? (
              <div className={styles.results}>
                {safeMetrics(entry.result as Result).map(([key, value]) => (
                  <div className={styles.metric} key={key}><span>{key.replaceAll("_", " ")}</span><strong>{String(value)}</strong></div>
                ))}
                <button className={styles.export} type="button" onClick={() => {
                  const blob = new Blob([JSON.stringify(entry.result, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "genithm-chat-science-result.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}>Export scientific JSON</button>
              </div>
            ) : null}
          </div>
        ))}
        {pending ? <div className={styles.assistant} role="status">Running local scientific algorithm...</div> : null}
      </div>
      <div className={styles.examples}>
        {examples.map((example) => <button type="button" key={example} onClick={() => setPrompt(example)} disabled={pending}>{example}</button>)}
      </div>
      <form className={styles.composer} onSubmit={submit}>
        {filename ? <div className={styles.file}>{filename} <button type="button" onClick={() => {setAttached("");setFilename("");}}>Remove</button></div> : null}
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={8000} rows={3} disabled={pending} aria-label="Describe your scientific analysis" placeholder="Example: Find ORFs in ATGAAATAA" />
        <div className={styles.footer}>
          <input ref={fileRef} hidden type="file" accept=".fa,.fasta,.fna,.fas,.txt" onChange={(event) => void pick(event)} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={pending}>+ Attach FASTA</button>
          <button type="submit" disabled={pending || !prompt.trim()}>{pending ? "Analyzing..." : "Analyze in chat →"}</button>
        </div>
      </form>
      <p className={styles.note}>Codespaces-only, local exploratory computation. No database account, remote LLM, billing or permanent artifact storage. Production research requires authenticated workflows and validated evidence.</p>
    </section>
  );
}
