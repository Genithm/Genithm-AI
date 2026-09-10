"use client";

const sections = [
  { label: "Setup", heading: "Organizations" },
  { label: "Inputs", heading: "Private FASTA inputs" },
  { label: "NCBI", heading: "Retrieve from NCBI" },
  { label: "BLAST", heading: "BLAST analysis" },
  { label: "Align", heading: "Alignment workflows" },
  { label: "Phylogeny", heading: "Build a tree from a completed MSA" },
  { label: "Protein", heading: "Deterministic protein properties" },
  { label: "History", heading: "Recent scientific analyses" },
] as const;

function scrollToHeading(heading: string) {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("main.dashboard h2"));
  const target = headings.find((element) => element.textContent?.trim() === heading);
  const section = target?.closest<HTMLElement>("section.card") ?? target;
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DashboardSectionNavigator() {
  return (
    <nav className="dashboard-section-nav" aria-label="Scientific workflow sections">
      <div className="container dashboard-section-nav-inner">
        <span className="dashboard-section-nav-label">Research flow</span>
        <div className="dashboard-section-nav-links">
          {sections.map((section, index) => (
            <button
              className="dashboard-section-link"
              key={section.label}
              type="button"
              onClick={() => scrollToHeading(section.heading)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {section.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
