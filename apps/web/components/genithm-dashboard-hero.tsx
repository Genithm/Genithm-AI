export function GenithmDashboardHero({ user }: { user: string }) {
  const displayName = user.split("@")[0] || "Researcher";

  return (
    <section className="workspace-hero">
      <div>
        <div className="workspace-kicker">
          <span className="workspace-status-dot" aria-hidden="true" />
          Genithm Research Workspace
        </div>
        <h1 className="workspace-title">Welcome back, {displayName}</h1>
        <p className="workspace-summary">
          Run reproducible bioinformatics workflows, inspect evidence, and move from sequence input to scientific interpretation in one workspace.
        </p>
      </div>
      <div className="workspace-identity">
        <span className="workspace-identity-label">Signed in as</span>
        <strong>{user}</strong>
        <span className="workspace-identity-meta">Private research session</span>
      </div>
    </section>
  );
}
