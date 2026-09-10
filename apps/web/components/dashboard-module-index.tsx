import { GenithmDashboardHero } from "./genithm-dashboard-hero";
import { LaunchReadinessPanel } from "./launch-readiness-panel";
import { NavigationCommandBar } from "./navigation-command-bar";
import { ResearchMetricsOverview } from "./research-metrics-overview";
import { WorkspaceHealthIndicator } from "./workspace-health-indicator";

export function DashboardModuleIndex({
  user = "Authenticated researcher",
  organizations,
  projects,
  analyses,
}: {
  user?: string;
  organizations: number;
  projects: number;
  analyses: number;
}) {
  return (
    <>
      <GenithmDashboardHero user={user} />
      <ResearchMetricsOverview
        organizations={organizations}
        projects={projects}
        analyses={analyses}
      />
      <NavigationCommandBar />
      <WorkspaceHealthIndicator />
      <LaunchReadinessPanel />
    </>
  );
}
