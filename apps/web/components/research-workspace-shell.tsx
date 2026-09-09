import { AiResearchAssistantPanel } from "./ai-research-assistant-panel";
import { EvidenceGraphVisualizer } from "./evidence-graph-visualizer";
import { ResearchCommandCenter } from "./research-command-center";
import { ScientificTimeline } from "./scientific-timeline";

export function ResearchWorkspaceShell({
  activeJobs,
  completed,
  timeline,
  evidence,
}: {
  activeJobs: number;
  completed: number;
  timeline: Array<{ label: string; status: string }>;
  evidence: Array<{ label: string; type: string }>;
}) {
  return (
    <>
      <ResearchCommandCenter activeJobs={activeJobs} completed={completed} />
      <ScientificTimeline jobs={timeline} />
      <EvidenceGraphVisualizer nodes={evidence} />
      <AiResearchAssistantPanel />
    </>
  );
}
