import { NextResponse } from "next/server";

import { loadWorkflowDiagnostic } from "@/lib/workflow-evidence.server";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadWorkflowDiagnostic(id);
  if (!result.ok) {
    return NextResponse.json({
      error: result.status === 401 ? "Authentication required" :
        result.status === 404 ? "Not found" : "Workflow evidence unavailable",
    }, { status: result.status, headers });
  }
  // Only bounded, RLS-authorized status metadata. No user prompts, AI answers,
  // raw scientific artifacts, private storage paths or worker failure bodies.
  return NextResponse.json({
    schema_version: "genithm-workflow-diagnostic/1",
    ...result.value,
  }, {
    status: 200,
    headers: {
      ...headers,
      "Content-Disposition": 'attachment; filename="genithm-workflow-' + id + '.json"',
    },
  });
}
