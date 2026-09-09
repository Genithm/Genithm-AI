export function ResearchActivityFeed({
  activities,
}: {
  activities: Array<{ title: string; detail: string }>;
}) {
  return (
    <section className="card futuristic-card" style={{ marginTop: 18 }}>
      <div className="eyebrow">Research activity</div>
      <h2>Latest operations</h2>
      <div className="list">
        {activities.length ? (
          activities.map((activity, index) => (
            <div className="item" key={`${activity.title}-${index}`}>
              <strong>{activity.title}</strong>
              <div className="small">{activity.detail}</div>
            </div>
          ))
        ) : (
          <div className="notice">No recent activity.</div>
        )}
      </div>
    </section>
  );
}
