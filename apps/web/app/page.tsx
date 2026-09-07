import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <div className="eyebrow">AI scientific orchestration</div>
        <h1>From biological question to reproducible evidence.</h1>
        <p>
          Genithm AI is being built as a secure bioinformatics research workspace where AI plans and explains,
          policy authorizes, trusted scientific tools execute, and every result carries evidence and provenance.
        </p>
        <div className="actions">
          <Link className="button primary" href="/login">Open workspace</Link>
          <a className="button" href="#principles">Architecture principles</a>
        </div>
      </section>
      <section id="principles" className="grid">
        <article className="card"><h2>Evidence first</h2><p>Scientific claims are tied to executed tools, inputs, versions, outputs, and source evidence.</p></article>
        <article className="card"><h2>Tenant isolated</h2><p>Workspace access is enforced in PostgreSQL with Row Level Security, not only in application code.</p></article>
        <article className="card"><h2>Controlled execution</h2><p>Long-running scientific tools will run through isolated workers, not unrestricted model or API shell access.</p></article>
      </section>
    </main>
  );
}
