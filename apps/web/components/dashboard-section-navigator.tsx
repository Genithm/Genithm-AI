"use client";

import { useEffect, useState } from "react";

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

function sectionElement(heading: string) {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("main.dashboard h2"));
  const target = headings.find((element) => element.textContent?.trim() === heading);
  return target?.closest<HTMLElement>("section.card") ?? target ?? null;
}

function scrollToHeading(heading: string) {
  sectionElement(heading)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DashboardSectionNavigator() {
  const [activeHeading, setActiveHeading] = useState<string>(sections[0].heading);

  useEffect(() => {
    const observed = sections
      .map((section) => ({ heading: section.heading, element: sectionElement(section.heading) }))
      .filter((entry): entry is { heading: string; element: HTMLElement } => Boolean(entry.element));

    if (!observed.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0];
        if (!visible) return;
        const match = observed.find((entry) => entry.element === visible.target);
        if (match) setActiveHeading(match.heading);
      },
      { rootMargin: "-150px 0px -60% 0px", threshold: [0, 0.01, 0.2] },
    );

    observed.forEach((entry) => observer.observe(entry.element));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="dashboard-section-nav" aria-label="Scientific workflow sections">
      <div className="container dashboard-section-nav-inner">
        <span className="dashboard-section-nav-label">Research flow</span>
        <div className="dashboard-section-nav-links">
          {sections.map((section, index) => {
            const active = section.heading === activeHeading;
            return (
              <button
                className={active ? "dashboard-section-link is-active" : "dashboard-section-link"}
                key={section.label}
                type="button"
                aria-current={active ? "step" : undefined}
                onClick={() => {
                  setActiveHeading(section.heading);
                  scrollToHeading(section.heading);
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {section.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
