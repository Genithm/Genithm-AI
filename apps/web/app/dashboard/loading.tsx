import styles from "./dashboard-state.module.css";

export default function DashboardLoading() {
  return (
    <main className={styles.statePage} aria-busy="true" aria-live="polite">
      <section className={styles.stateHero}>
        <div className={styles.stateKicker}>Preparing research workspace</div>
        <h1>Loading your scientific workspace.</h1>
        <p>Genithm is resolving your projects, validated inputs, and recent scientific execution state.</p>
      </section>

      <section className={styles.loadingGrid} aria-label="Loading workspace summary">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div className={styles.loadingCard} key={item}>
            <div className={`${styles.skeletonLine} ${item % 2 ? styles.skeletonLineShort : ""}`} />
            <div className={styles.skeletonBlock} />
          </div>
        ))}
      </section>
    </main>
  );
}
