import Link from "next/link";
import { notFound } from "next/navigation";

import { SampleWorkbench } from "./sample-workbench";
import { LiveSequenceLab } from "./live-sequence-lab";
import { ComparativeSequenceLab } from "./comparative-sequence-lab";
import styles from "./preview.module.css";

export const metadata = {
  title: "Genithm | Development Workbench",
  description: "Local Codespaces UI preview using non-sensitive scientific sample data",
};

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  // Never expose the preview in a production deployment.
  if (process.env.NODE_ENV !== "development" || process.env.GENITHM_CODESPACES_PREVIEW !== "1") {
    notFound();
  }

  const { setup } = await searchParams;
  const configured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  return (
    <main className={styles.shell}>
      <div className={styles.utilityBar}>
        <span className={styles.eyebrow}>GENITHM / RESEARCH WORKBENCH</span>
        <span className={styles.devBadge}>CODESPACES DEV PREVIEW</span>
      </div>

      <section className={styles.hero}>
        <div>
          <div className={styles.kicker}>Explore the scientific platform</div>
          <h1>From biological sequence to explainable insight.</h1>
          <p>
            Preview the Genithm research experience with a small verified DNA fixture.
            The sample examples are illustrative; the interactive lab computes actual local results. No live customer job is submitted.
          </p>
          <div className={styles.heroActions}>
            {configured ? (
              <Link className="button primary" href="/dashboard/ai">Open authenticated workspace</Link>
            ) : (
              <a className="button primary" href="#research-workbench">Explore sample analyses</a>
            )}
            <Link className="button" href="/">Back to Genithm home</Link>
          </div>
        </div>
        <div className={styles.heroPanel} aria-label="Research preview statistics">
          <div className={styles.panelTop}>DEV / RESEARCH SESSION 001</div>
          <div className={styles.sequenceIcon} aria-hidden="true">ATG · AAA · TAA</div>
          <div className={styles.panelBottom}>
            <div><strong>04</strong><span>Analysis methods</span></div>
            <div><strong>09</strong><span>Sample nucleotides</span></div>
            <div><strong>06</strong><span>Reading frames</span></div>
          </div>
        </div>
      </section>

      {!configured ? (
        <section className={styles.setupNotice} role="status">
          <div>
            <strong>{setup === "1" ? "This feature requires a development Supabase connection" : "Preview mode is active"}</strong>
            <p>
              The public demo runs without credentials. For real accounts, projects and AI tools, configure
              <code> NEXT_PUBLIC_SUPABASE_URL </code> and
              <code> NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY </code>
              using your Codespace&apos;s environment/secrets, then restart the web server.
              Use a separate development Supabase project rather than production research data.
            </p>
          </div>
          <span className={styles.setupState}>OFFLINE DEMO</span>
        </section>
      ) : (
        <section className={styles.setupNotice}>
          <div>
            <strong>Supabase public environment configured</strong>
            <p>Public browser configuration is present. Authenticated workflows still require a migrated development database and compatible workers.</p>
          </div>
          <span className={styles.connectedState}>CONFIGURED</span>
        </section>
      )}

      <section className={styles.workspace} id="research-workbench">
        <div className={styles.sectionHeading}>
          <div>
            <div className={styles.kicker}>Scientific sequence intelligence</div>
            <h2>Explore four analysis results</h2>
          </div>
          <span className={styles.sampleTag}>FIXTURE: ATGAAATAA</span>
        </div>
        <SampleWorkbench />
      </section>

      <LiveSequenceLab />

      <ComparativeSequenceLab />

      <section className={styles.bottomGrid}>
        <article className={styles.foundation}>
          <div className={styles.kicker}>Trusted computation</div>
          <h3>Scientific execution is not AI guesswork.</h3>
          <p>
            Genithm separates planning from execution. Python scientific workers run bounded algorithms,
            and immutable results retain input hashes, tool versions and reproducible evidence.
          </p>
        </article>
        <article className={styles.foundation}>
          <div className={styles.kicker}>What runs where</div>
          <h3>Codespaces for development. Deployment later.</h3>
          <p>
            In Codespaces, you can preview this interface and test scientific algorithms without Oracle.
            Full project workflows need a development Supabase backend and running worker processes.
          </p>
        </article>
      </section>
    </main>
  );
}
