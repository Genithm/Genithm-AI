import { NextResponse } from "next/server";

import { loadDossier } from "@/lib/research-dossier.server";
import { renderDossierMarkdown } from "@/lib/research-dossier";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Vary": "Cookie",
};

export async function GET(request: Request, context: {
  params: Promise<{ format: string }>;
}) {
  const { format } = await context.params;
  if (format !== "json" && format !== "markdown") {
    return NextResponse.json({ error: "Unsupported dossier format." }, { status: 404, headers });
  }
  const url = new URL(request.url);
  const result = await loadDossier(
    url.searchParams.get("project_id") ?? "",
    url.searchParams.getAll("report_id"),
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status, headers });
  }
  const { dossier, projectName } = result;
  const filename = "genithm-research-dossier-" + dossier.payload.project_id;
  let body: string;
  let contentType: string;
  let suffix: string;
  if (format === "json") {
    body = JSON.stringify({
      schema_version: "genithm-dossier-bundle/1",
      payload: dossier.payload,
      comparison: dossier.comparison,
      checksum: {
        algorithm: "SHA-256",
        canonicalization: "recursive sorted JSON object keys; JSON.stringify primitives; UTF-8",
        scope: "payload",
        canonical_payload_sha256: dossier.canonical_payload_sha256,
      },
      interpretation_policy: "Recorded scientific evidence only; no new AI inferences were created.",
    }, null, 2) + "\n";
    contentType = "application/json; charset=utf-8";
    suffix = "json";
  } else {
    body = renderDossierMarkdown(dossier, projectName);
    contentType = "text/markdown; charset=utf-8";
    suffix = "md";
  }
  return new Response(body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": contentType,
      "Content-Disposition": 'attachment; filename="' + filename + "." + suffix + '"',
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
      "X-Genithm-Dossier-Payload-SHA256": dossier.canonical_payload_sha256,
      "X-Genithm-Verified-Report-Count": String(dossier.report_count),
    },
  });
}
