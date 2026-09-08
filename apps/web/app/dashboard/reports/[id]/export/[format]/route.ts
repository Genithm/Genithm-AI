import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { renderScientificReportHtml, renderScientificReportMarkdown } from "@/lib/scientific-report";

const formats = new Set(["json", "markdown", "html"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  if (!formats.has(format)) return NextResponse.json({ error: "Unsupported report format." }, { status: 404 });

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data, error } = await supabase.rpc("get_scientific_report", { report_id: id });
  const report = data?.[0];
  if (error || !report) return NextResponse.json({ error: "Scientific report not found." }, { status: 404 });
  if (!report.integrity_valid) return NextResponse.json({ error: "Scientific report integrity check failed. Export refused." }, { status: 409 });

  let body: string;
  let contentType: string;
  let extension: string;
  if (format === "json") {
    body = `${JSON.stringify(report.report_snapshot, null, 2)}\n`;
    contentType = "application/json; charset=utf-8";
    extension = "json";
  } else if (format === "markdown") {
    body = renderScientificReportMarkdown(report.report_snapshot);
    contentType = "text/markdown; charset=utf-8";
    extension = "md";
  } else {
    body = renderScientificReportHtml(report.report_snapshot, report.report_sha256);
    contentType = "text/html; charset=utf-8";
    extension = "html";
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename=\"genithm-scientific-report-${report.id}.${extension}\"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Genithm-Report-SHA256": report.report_sha256,
      "X-Genithm-Source-Evidence-SHA256": report.source_evidence_sha256 ?? report.source_result_sha256 ?? "",
    },
  });
}
