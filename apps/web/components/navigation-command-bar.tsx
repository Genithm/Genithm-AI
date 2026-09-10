import Link from "next/link";

const shortcuts = [
  {
    href: "#sequence-ingestion",
    eyebrow: "01 · Start",
    title: "Upload a sequence",
    description: "Add a private FASTA input and queue deterministic validation.",
  },
  {
    href: "#similarity-search",
    eyebrow: "02 · Analyze",
    title: "Run scientific analysis",
    description: "Move from validated sequence to BLAST, alignment, MSA, phylogeny, or protein analysis.",
  },
  {
    href: "#scientific-history",
    eyebrow: "03 · Review",
    title: "Inspect evidence",
    description: "Open completed runs, provenance, checksums, and reproducible outputs.",
  },
];

export function NavigationCommandBar() {
  return (
    <section className="workflow-panel" aria-labelledby="workflow-heading">
      <div className="section-heading-row">
        <div>
          <div className="eyebrow">Research workflow</div>
          <h2 id="workflow-heading">Move from input to evidence</h2>
        </div>
        <span className="section-caption">V1 scientific workflow</span>
      </div>
      <div className="workflow-grid">
        {shortcuts.map((shortcut) => (
          <Link className="workflow-card" href={shortcut.href} key={shortcut.href}>
            <span className="workflow-step">{shortcut.eyebrow}</span>
            <strong>{shortcut.title}</strong>
            <span>{shortcut.description}</span>
            <span className="workflow-link">Open workflow →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
