export function ScientificResultExplorer({
  results,
}: {
  results: Array<{
    title: string;
    status: string;
    tool: string;
  }>;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Result explorer</div>
      <h2>Scientific analysis archive</h2>
      <p>
        Review completed workflows with tool identity, execution status, and
        reproducibility context.
      </p>
      <div className="list">
        {results.length ? (
          results.map((result, index) => (
            <div className="item" key={`${result.title}-${index}`}>
              <strong>{result.title}</strong>
              <div className="small">{result.tool} · {result.status}</div>
            </div>
          ))
        ) : (
          <div className="notice">No scientific results available.</div>
        )}
      </div>
    </section>
  );
}
