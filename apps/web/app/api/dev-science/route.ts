import { NextResponse, type NextRequest } from "next/server";

const LOCAL_ENGINE_URL = "http://127.0.0.1:8769/analyze";
const MAX_BODY_BYTES = 8192;

function json(data: Record<string, unknown>, status: number) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  // Never run scientific code or call the loopback engine in production.
  if (process.env.NODE_ENV !== "development" ||
      process.env.GENITHM_CODESPACES_PREVIEW !== "1") {
    return json({ error: "not found" }, 404);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return json({ error: "cross-site requests are not allowed" }, 403);
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const requestedHost = request.headers.get("x-forwarded-host") ??
        request.headers.get("host") ?? request.nextUrl.host;
      if (new URL(origin).host !== requestedHost) {
        return json({ error: "cross-origin requests are not allowed" }, 403);
      }
    } catch {
      return json({ error: "invalid origin" }, 403);
    }
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
    return json({ error: "input exceeds request size limit" }, 413);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "application/json required" }, 415);
  }

  const text = await readBoundedBody(request);
  if (!text) return json({ error: "invalid or oversized request" }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return json({ error: "invalid JSON request" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "invalid scientific request" }, 422);
  }
  const params = payload as Record<string, unknown>;
  const fields = Object.keys(params);
  if (fields.length !== 5 || fields.some((key) =>
      !["sequence", "sequence_type", "operation", "motif", "min_aa"].includes(key)
    ) ||
    typeof params.sequence !== "string" || params.sequence.length > 5500) {
    return json({ error: "invalid scientific request" }, 422);
  }

  try {
    const response = await fetch(LOCAL_ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
      // MAFFT and FastTree each have a bounded local runtime. The proxy must
      // allow both stages to finish without changing the short timeout for
      // basic nucleotide operations.
      signal: AbortSignal.timeout(
        params.operation === "msa_conservation" || params.operation === "msa_phylogeny" ? 45000 : 8000
      ),
    });
    if (!response.ok && ![400, 413, 415, 422, 429].includes(response.status)) {
      return json({ error: "local scientific engine is unavailable" }, 503);
    }
    const result = await response.json();
    return json(result, response.status);
  } catch {
    return json({ error: "local scientific engine is not running; restart your Codespace" }, 503);
  }
}
