import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  createOrganization,
  createProject,
  requestBlastJob,
  requestMultipleSequenceAlignment,
  requestNcbiSequence,
  requestPairwiseAlignment,
  requestPhylogeneticTree,
  requestProteinProperties,
} from "./actions";
import { ProteinAnnotationPanel } from "./protein-annotation-panel";
import { SequenceUploadPanel } from "./sequence-upload-panel";
import { ResearchOsFinalLayout } from "@/components/research-os-final-layout";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function warningLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.replaceAll("_", " "));
}

type StatisticsSummary = {
  gcContentPercent: number | null;
  gcMethod: string | null;
  minLength: number;
  maxLength: number;
  meanLength: number;
  gapCount: number;
  composition: Array<[string, number]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStatistics(value: unknown): StatisticsSummary | null {
  if (!isRecord(value)) return null;
  const recordLength = value.record_length;
  const composition = value.composition;
  if (!isRecord(recordLength) || !isRecord(composition)) return null;
  const minLength = numberValue(recordLength.min);
  const maxLength = numberValue(recordLength.max);
  const meanLength = numberValue(recordLength.mean);
  const gapCount = numberValue(value.gap_count);
  if (minLength === null || maxLength === null || meanLength === null || gapCount === null) return null;
  return { gcContentPercent: numberValue(value.gc_content_percent), gcMethod: typeof value.gc_method === "string" ? value.gc_method : null, minLength, maxLength, meanLength, gapCount, composition: Object.entries(composition).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])).sort(([a], [b]) => a.localeCompare(b)) };
}

function parseBlastHits(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord).slice(0, 5) : [];
}

function scientificSummary(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function scientificLabel(jobType: string) { if (jobType === "multiple_sequence_alignment") return "Multiple Sequence Alignment"; if (jobType === "phylogenetic_tree") return "Phylogenetic Tree"; if (jobType === "protein_properties") return "Protein Properties"; return "Pairwise Alignment"; }

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");
  const [{ data: organizations }, { data: projects }, { data: sequenceUploads }, { data: retrievals }, { data: blastJobs }, { data: scientificJobs }] = await Promise.all([]);
  const jobs = scientificJobs ?? [];
  return (<main className="container dashboard"><ResearchOsFinalLayout organizations={organizations?.length ?? 0} projects={projects?.length ?? 0} jobs={jobs}/><header className="dashboard-header"></header></main>);
}
