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

// ...

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: organizations }, { data: projects }, { data: sequenceUploads }, { data: retrievals }, { data: blastJobs }, { data: scientificJobs }] = await Promise.all([]);

  const jobs = scientificJobs ?? [];

  return (
    <main className="container dashboard">
      <ResearchOsFinalLayout
        organizations={organizations?.length ?? 0}
        projects={projects?.length ?? 0}
        jobs={jobs}
      />
      <header className="dashboard-header">
      </header>
    </main>
  );
}
