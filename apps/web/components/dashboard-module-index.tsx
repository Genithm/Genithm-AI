import { AiResearchAssistantPanel } from "@/components/ai-research-assistant-panel";
import { EvidenceGraphVisualizer } from "@/components/evidence-graph-visualizer";
import { EvidenceReportPanel } from "@/components/evidence-report-panel";
import { GenithmDashboardHero } from "@/components/genithm-dashboard-hero";
import { LaunchReadinessPanel } from "@/components/launch-readiness-panel";
import { NavigationCommandBar } from "@/components/navigation-command-bar";
import { ResearchActivityFeed } from "@/components/research-activity-feed";
import { ResearchCommandCenter } from "@/components/research-command-center";
import { ResearchMetricsOverview } from "@/components/research-metrics-overview";
import { ResearchWorkspaceData } from "@/components/research-workspace-data";
import { ResearchWorkspaceShell } from "@/components/research-workspace-shell";
import { ScientificEvidenceSummary } from "@/components/scientific-evidence-summary";
import { ScientificResultExplorer } from "@/components/scientific-result-explorer";

export function DashboardModuleIndex({
  user,
  organizations,
  projects,
  analyses,
}: {
  user: string;
  organizations: number;
  projects: number;
  analyses: number;
}) {
  return (
    <>
      <GenithmDashboardHero user={user} />
      <NavigationCommandBar />
      <ResearchMetricsOverview
        organizations={organizations}
        projects={projects}
        analyses={analyses}
      />
      <ResearchCommandCenter />
      <ResearchWorkspaceShell />
      <ResearchWorkspaceData />
      <ScientificResultExplorer />
      <ScientificEvidenceSummary />
      <EvidenceGraphVisualizer />
      <EvidenceReportPanel />
      <AiResearchAssistantPanel />
      <ResearchActivityFeed />
      <LaunchReadinessPanel />
    </>
  );
}
