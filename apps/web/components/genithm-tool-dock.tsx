import Link from "next/link";

import { ResearchActivityRefresh } from "@/components/research-activity-refresh";
import { activityTitle, classifyActivity, statusLabel } from "@/lib/scientific-activity";

export type RecentScientificRun = {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  result_sha256: string | null;
};

type Props = {
  projectCount: number;
  scienceReady: boolean;
  recentRuns: RecentScientificRun[];
  recentRunsError: boolean;
};

const tools = [
  { icon: "⌘", name: "Sequence analysis", detail: "FASTA validation, ORFs and composition", href: "/dashboard/tools" },
  { icon: "⇄", name: "Sequence alignment", detail: "Pairwise alignment and MAFFT", href: "/dashboard/tools" },
  { icon: "◎", name: "BLAST and homology", detail: "Similarity searches with recorded evidence", href: "/dashboard/tools" },
  { icon: "◈", name: "Protein analysis", detail: "Protein properties and annotation", href: "/dashboard/tools" },
  { icon: "♧", name: "Phylogenetics", detail: "Multiple alignment and tree workflows", href: "/dashboard/workflows" },
  { icon: "⚡", name: "Scientific pipelines", detail: "Approved multistep computations", href: "/dashboard/pipelines" },
] as const;

/** Navigation only: every item leads to an existing authenticated route.
 *  Never display example datasets or invented execution statuses as real science.
 */
export function GenithmToolDock({ projectCount, scienceReady, recentRuns, recentRunsError }: Props) {
  const active = recentRuns.some((run) => classifyActivity("scientific", run.status) === "active");
  return (
    <aside className="genithm-tool-dock" aria-label="Bioinformatics tools and workspace status">
      <ResearchActivityRefresh active={active} />
      <div className="genithm-dock-heading">
        <div>
          <span className="genithm-dock-kicker">SCIENTIFIC WORKSPACE</span>
          <h2>Research tools</h2>
        </div>
        <span className="genithm-dock-dna" aria-hidden="true">⌘</span>
      </div>
      <div className="genithm-dock-section">
        <span className="genithm-dock-label">Quick actions</span>
        <Link className="genithm-dock-primary" href="/dashboard/tools">
          <span aria-hidden="true">＋</span><span><strong>Upload & analyze</strong><small>Validated FASTA and scientific tools</small></span><span aria-hidden="true">↗</span>
        </Link>
        <Link className="genithm-dock-action" href="/dashboard/pipelines">
          <span aria-hidden="true">▶</span><span><strong>Run a pipeline</strong><small>Permission-controlled scientific execution</small></span><span aria-hidden="true">↗</span>
        </Link>
        <Link className="genithm-dock-action" href="/dashboard/ai/research">
          <span aria-hidden="true">▤</span><span><strong>Research history</strong><small>Recorded runs, sources and outputs</small></span><span aria-hidden="true">↗</span>
        </Link>
      </div>
      <div className="genithm-dock-section">
        <span className="genithm-dock-label">Built-in bioinformatics</span>
        <nav className="genithm-dock-tools" aria-label="Scientific module shortcuts">
          {tools.map((tool) => (
            <Link href={tool.href} key={tool.name}>
              <span className="genithm-tool-icon" aria-hidden="true">{tool.icon}</span>
              <span className="genithm-tool-copy"><strong>{tool.name}</strong><small>{tool.detail}</small></span>
              <span className="genithm-tool-arrow" aria-hidden="true">›</span>
            </Link>
          ))}
        </nav>
      </div>
      <div className="genithm-dock-section genithm-dock-recent">
        <span className="genithm-dock-label">Recent scientific runs</span>
        {recentRunsError ? (
          <p className="genithm-recent-warning" role="alert">Recent runs are unavailable. No job status was inferred.</p>
        ) : recentRuns.length ? (
          <div className="genithm-recent-list">
            {recentRuns.map((run) => (
              <Link href={`/dashboard/scientific-jobs/${run.id}`} key={run.id}
                className="genithm-recent-item">
                <span className="genithm-recent-title">{activityTitle("scientific", run.job_type)}</span>
                <span className="genithm-recent-status">{statusLabel(run.status)}</span>
                <small>{classifyActivity("scientific", run.status) === "completed" && run.result_sha256
                  ? "Result fingerprint recorded" : "Open execution details"}</small>
              </Link>
            ))}
          </div>
        ) : <p className="genithm-recent-empty">No scientific runs recorded yet.</p>}
        <Link className="genithm-dock-footerlink" href="/dashboard/results">View all results →</Link>
      </div>
      <div className="genithm-dock-section genithm-dock-status">
        <span className="genithm-dock-label">Active environment</span>
        <div className="genithm-environment">
          <span className={scienceReady ? "genithm-env-ready" : "genithm-env-offline"} aria-hidden="true" />
          <div><strong>{scienceReady ? "Scientific workers available" : "Scientific workers unavailable"}</strong>
            <small>{scienceReady ? "Computations still require authorization" : "Chat and saved results remain accessible"}</small>
          </div>
        </div>
        <div className="genithm-project-count"><span>Research projects</span><strong>{projectCount}</strong></div>
        <Link className="genithm-dock-footerlink" href="/dashboard/operations">View execution status →</Link>
      </div>
    </aside>
  );
}
