import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container futuristic-home">
      <section className="hero glass-hero">
        <div className="eyebrow">Genithm Intelligence Platform</div>
        <h1>AI powered discovery engine for biological research.</h1>
        <p>
          Transform biological questions into reproducible scientific workflows. Genithm combines AI reasoning,
          trusted computational tools, evidence tracking, and provenance-first research execution.
        </p>
        <div className="actions">
          <Link className="button primary glow" href="/login">Enter Research Workspace</Link>
          <a className="button" href="#capabilities">Explore Platform</a>
        </div>
        <div className="status-orb">
          <span /> Live scientific orchestration layer
        </div>
      </section>

      <section id="capabilities" className="grid futuristic-grid">
        <article className="card futuristic-card">
          <div className="card-icon">🧬</div>
          <h2>Bio Intelligence</h2>
          <p>AI-assisted workflows for sequences, proteins, and computational biology research.</p>
        </article>
        <article className="card futuristic-card">
          <div className="card-icon">◈</div>
          <h2>Evidence Graph</h2>
          <p>Every result is connected to inputs, tools, versions, outputs, and provenance.</p>
        </article>
        <article className="card futuristic-card">
          <div className="card-icon">⚡</div>
          <h2>Secure Compute</h2>
          <p>Isolated scientific workers execute research pipelines with controlled access.</p>
        </article>
      </section>
    </main>
  );
}
