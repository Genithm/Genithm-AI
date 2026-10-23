/** Direct Google AI Studio -> Groq routing. Pass environment only from server-only code. */
export type ProviderName = "gemini" | "groq";
export type AiProvider = {
  name: ProviderName;
  apiKey: string;
  endpoint: string;
  model: string;
  supportsImages: boolean;
};
export type GatewayLimits = { firstOutputMs: number; idleMs: number; totalMs: number };
export type StreamingChatProvider = {
  body: ReadableStream<Uint8Array>;
  provider: ProviderName;
  model: string;
  configuredModel: string;
  firstOutputMs: number;
  fallbackUsed: boolean;
};
type Environment = Record<string, string | undefined>;
const ENDPOINTS = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
} as const;
const encoder = new TextEncoder();

export class ProviderFailure extends Error {
  readonly fallbackAllowed: boolean;
  constructor(message: string, fallbackAllowed = true) {
    super(message);
    this.name = "ProviderFailure";
    this.fallbackAllowed = fallbackAllowed;
  }
}

function key(value: string | undefined, name: string, required: boolean) {
  const result = (value || "").trim();
  if ((!result && required) || result.length > 4096 || /[\r\n]/.test(result)) {
    throw new ProviderFailure(`${name} is missing or invalid in server configuration.`, false);
  }
  return result;
}
function model(value: string | undefined, fallback: string, google = false) {
  const result = (value || fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(result) || (google && !result.startsWith("gemini-"))) {
    throw new ProviderFailure("The configured AI model identifier is invalid.", false);
  }
  return result;
}

export function configuredProviders(env: Environment): [AiProvider, AiProvider | null] {
  // Never read legacy generic API-key/endpoint variables: an old secret cannot be sent to a new vendor.
  const primary: AiProvider = {
    name: "gemini", endpoint: ENDPOINTS.gemini, supportsImages: true,
    apiKey: key(env.GEMINI_API_KEY, "GEMINI_API_KEY", true),
    model: model(env.GENITHM_GEMINI_MODEL, "gemini-3.8-flash", true),
  };
  const secondaryKey = key(env.GROQ_API_KEY, "GROQ_API_KEY", false);
  const secondary: AiProvider | null = secondaryKey ? {
    name: "groq", endpoint: ENDPOINTS.groq, supportsImages: false,
    apiKey: secondaryKey,
    model: model(env.GENITHM_GROQ_MODEL, "llama-3.3-70b-versatile"),
  } : null;
  return [primary, secondary];
}

export function reasoningEffort(env: Environment, hasEvidence = false): "low" | "medium" | "high" {
  const value = (env.GENITHM_GEMINI_REASONING_EFFORT || (hasEvidence ? "medium" : "low")).trim();
  if (!["low","medium","high"].includes(value)) throw new ProviderFailure("Invalid Gemini reasoning effort.", false);
  return value as "low" | "medium" | "high";
}
export function gatewayLimits(env: Environment): GatewayLimits {
  function integer(name: string, fallback: number, min: number, max: number) {
    const value = env[name] === undefined || env[name] === "" ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ProviderFailure(`${name} must be an integer from ${min} to ${max}.`, false);
    }
    return value;
  }
  const limits = {
    firstOutputMs: integer("GENITHM_AI_FIRST_OUTPUT_TIMEOUT_MS", 8000, 1000, 30000),
    idleMs: integer("GENITHM_AI_STREAM_IDLE_TIMEOUT_MS", 15000, 1000, 60000),
    totalMs: integer("GENITHM_AI_TOTAL_TIMEOUT_MS", 60000, 10000, 180000),
  };
  if (limits.firstOutputMs >= limits.totalMs) throw new ProviderFailure("First-output timeout must be shorter than total timeout.", false);
  return limits;
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Generation stopped.", "AbortError");
}
function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

type Delta = {
  content?: string | null;
  refusal?: string | null;
  tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
};
type Chunk = { model?: string; error?: unknown; choices?: Array<{ delta?: Delta; finish_reason?: string | null }> };

/** Validate transport completion without ever interpreting a model tool call as permission to execute. */
async function* normalizedChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal,
  metadata: { model: string }, onOutput: () => void,
): AsyncGenerator<Uint8Array> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", finish = "", actualModel = "", toolId = "";
  let hasOutput = false, bytes = 0, argumentsLength = 0;
  while (true) {
    const read = await withAbort(reader.read(), signal);
    if (read.done) throw new ProviderFailure("AI stream ended before verified completion.");
    bytes += read.value.byteLength;
    if (bytes > 512 * 1024) throw new ProviderFailure("AI response exceeded the transport limit.");
    buffer += decoder.decode(read.value, { stream: true });
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      if (frame.length > 65536) throw new ProviderFailure("AI stream frame is too large.");
      const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      if (data.trim() === "[DONE]") {
        if (!hasOutput || !["stop", "tool_calls"].includes(finish)) throw new ProviderFailure("AI response was empty or incomplete.");
        yield encoder.encode(`data: ${JSON.stringify({ model: metadata.model, choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      let parsed: Chunk;
      try { parsed = JSON.parse(data) as Chunk; } catch { throw new ProviderFailure("AI provider returned a malformed stream."); }
      if (!parsed || typeof parsed !== "object" || parsed.error) throw new ProviderFailure("AI provider returned a stream error.");
      if (parsed.model !== undefined) {
        if (typeof parsed.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(parsed.model)) throw new ProviderFailure("AI provider returned invalid model provenance.");
        if (actualModel && actualModel !== parsed.model) throw new ProviderFailure("AI model changed during a response.", false);
        actualModel = parsed.model;
        metadata.model = actualModel;
      }
      if (parsed.choices === undefined) continue;
      if (!Array.isArray(parsed.choices) || parsed.choices.length > 1) throw new ProviderFailure("AI provider returned an invalid choice count.");
      const choice = parsed.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) {
        if (!["stop", "tool_calls"].includes(choice.finish_reason)) throw new ProviderFailure("AI response was refused or truncated; it was not accepted as a completed result.", false);
        finish = choice.finish_reason;
      }
      const delta = choice.delta;
      if (!delta) continue;
      if (delta.refusal) throw new ProviderFailure("AI provider declined this request.", false);
      if (delta.content !== undefined && delta.content !== null && typeof delta.content !== "string") throw new ProviderFailure("AI provider returned invalid text.");
      const safeDelta: Delta = {};
      if (typeof delta.content === "string" && delta.content) safeDelta.content = delta.content;
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 1) throw new ProviderFailure("Only one scientific proposal is allowed per response.", false);
        for (const call of delta.tool_calls) {
          if (!call || (call.index !== undefined && call.index !== 0) || (call.type !== undefined && call.type !== "function")) throw new ProviderFailure("Only one scientific function proposal is allowed.", false);
          if (call.id) {
            if (typeof call.id !== "string" || (toolId && toolId !== call.id)) throw new ProviderFailure("AI returned multiple scientific proposals.", false);
            toolId = call.id;
          }
          if (call.function?.arguments !== undefined) {
            if (typeof call.function.arguments !== "string") throw new ProviderFailure("AI returned invalid tool arguments.", false);
            argumentsLength += call.function.arguments.length;
            if (argumentsLength > 30000) throw new ProviderFailure("Scientific tool arguments too large.", false);
          }
          if (call.function?.name !== undefined && typeof call.function.name !== "string") throw new ProviderFailure("AI returned an invalid tool name.", false);
        }
        safeDelta.tool_calls = delta.tool_calls;
      }
      const meaningful = Boolean(safeDelta.content?.trim() || safeDelta.tool_calls?.some(call => call.function?.name || call.function?.arguments?.trim()));
      if (!meaningful && !hasOutput) continue;
      if (!safeDelta.content && !safeDelta.tool_calls?.length) continue;
      hasOutput = true;
      onOutput();
      yield encoder.encode(`data: ${JSON.stringify({ model: metadata.model, choices: [{ delta: safeDelta }] })}\n\n`);
    }
    if (buffer.length > 65536) throw new ProviderFailure("AI stream frame is too large.");
  }
}

export async function streamFromProviders(
  providers: [AiProvider, AiProvider | null],
  payload: (provider: AiProvider) => Record<string, unknown>,
  options: { signal?: AbortSignal; hasImages?: boolean; limits?: GatewayLimits; fetcher?: typeof fetch } = {},
): Promise<StreamingChatProvider> {
  const started = Date.now();
  const limits = options.limits || { firstOutputMs: 8000, idleMs: 15000, totalMs: 60000 };
  const deadline = started + limits.totalMs;
  let lastError: unknown;
  if (providers[0]?.name !== "gemini" || (providers[1] && providers[1].name !== "groq"))
    throw new ProviderFailure("Provider order must be Gemini primary and Groq secondary.", false);
  for (const [index, provider] of providers.entries()) {
    aborted(options.signal);
    if (!provider) continue;
    if (!(provider.name in ENDPOINTS) || provider.endpoint !== ENDPOINTS[provider.name]) throw new ProviderFailure("Unapproved AI endpoint.", false);
    if (options.hasImages && !provider.supportsImages) throw new ProviderFailure("Gemini is unavailable. The Groq fallback is text-only; your images were not discarded or sent to it.", false);
    if (Date.now() >= deadline) throw new ProviderFailure("AI request exceeded its total deadline.", false);
    const controller = new AbortController();
    const cancel = () => controller.abort(new DOMException("Generation stopped.", "AbortError"));
    options.signal?.addEventListener("abort", cancel, { once: true });
    const totalTimer = setTimeout(() => controller.abort(new ProviderFailure("AI request exceeded its total deadline.", false)), deadline - Date.now());
    const firstTimer = setTimeout(() => controller.abort(new ProviderFailure(`${provider.name} did not start answering before the deadline.`)), limits.firstOutputMs);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let iterator: AsyncGenerator<Uint8Array> | undefined;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(firstTimer); clearTimeout(totalTimer); clearTimeout(idleTimer);
      options.signal?.removeEventListener("abort", cancel);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    };
    const output = () => {
      clearTimeout(firstTimer); clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(new ProviderFailure("AI response stalled before completion.", false)), limits.idleMs);
    };
    try {
      const response = await withAbort((options.fetcher || fetch)(provider.endpoint, {
        method: "POST", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...payload(provider), model: provider.model, stream: true }),
      }), controller.signal);
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw new ProviderFailure(`${provider.name} API request failed (HTTP ${response.status}).`, [401, 402, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504].includes(response.status));
      }
      if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new ProviderFailure("AI provider did not return a streaming response.");
      reader = response.body.getReader();
      const metadata = { model: provider.model };
      iterator = normalizedChunks(reader, controller.signal, metadata, output);
      const first = await iterator.next();
      if (first.done) throw new ProviderFailure("AI provider returned no answer.");
      const firstOutputMs = Date.now() - started;
      let initial: Uint8Array | undefined = first.value;
      const active = iterator;
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            if (initial) { stream.enqueue(initial); initial = undefined; return; }
            const next = await active.next();
            if (next.done) { cleanup(); stream.close(); } else stream.enqueue(next.value);
          } catch (error) { cleanup(); stream.error(error instanceof ProviderFailure || error instanceof DOMException ? error : new ProviderFailure("AI stream failed before completion.", false)); }
        },
        cancel() { cleanup(); void active.return(undefined).catch(() => undefined); },
      });
      return { body, provider: provider.name, get model() { return metadata.model; }, configuredModel: provider.model, firstOutputMs, fallbackUsed: index > 0 };
    } catch (error) {
      cleanup();
      aborted(options.signal);
      lastError = error instanceof ProviderFailure ? error : new ProviderFailure(`${provider.name} API could not be reached.`);
      if (lastError instanceof ProviderFailure && !lastError.fallbackAllowed) throw lastError;
    }
  }
  throw lastError instanceof ProviderFailure ? lastError : new ProviderFailure("No AI provider is configured.", false);
}
