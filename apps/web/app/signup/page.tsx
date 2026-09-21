import Link from "next/link";

import { signup } from "../login/actions";
import styles from "../login/login.module.css";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className={`container ${styles.page}`}>
      <section className={styles.shell} aria-labelledby="signup-title">
        <div className={styles.context}>
          <div>
            <Link className={styles.brand} href="/" aria-label="Genithm home">
              <span className={styles.mark} aria-hidden="true">G</span>
              <span className={styles.brandCopy}>
                <strong>Genithm</strong>
                <span>Research intelligence workspace</span>
              </span>
            </Link>

            <div style={{ marginTop: 54 }}>
              <div className="eyebrow">Create your workspace access</div>
              <h1>Start with a secure research identity.</h1>
              <p>
                Create an account for authenticated projects, sequence analysis, scientific jobs, provenance, and AI-assisted research workflows.
              </p>
            </div>
          </div>

          <div className={styles.trustGrid} aria-label="Workspace trust properties">
            <div className={styles.trustItem}>
              <span>Private</span>
              <strong>Your research workspace is scoped to your authenticated identity.</strong>
            </div>
            <div className={styles.trustItem}>
              <span>Reproducible</span>
              <strong>Analyses retain inputs, versions, hashes, and scientific provenance.</strong>
            </div>
            <div className={styles.trustItem}>
              <span>Connected</span>
              <strong>NCBI, BLAST, sequence, protein, phylogeny, and AI workflows live in one workspace.</strong>
            </div>
          </div>
        </div>

        <div className={styles.formPanel}>
          <Link className={styles.backLink} href="/">← Back to platform overview</Link>

          <div className={styles.formHeading}>
            <div className="eyebrow">New researcher</div>
            <h2 id="signup-title">Create your Genithm account</h2>
            <p>Use an email address you can access. Depending on project settings, email confirmation may be required.</p>
          </div>

          {params.error ? <div className={`error ${styles.feedback}`} role="alert">{params.error}</div> : null}

          <form className={styles.form} action={signup}>
            <label>
              Email address
              <input name="email" type="email" autoComplete="email" inputMode="email" required />
            </label>

            <label>
              Password
              <input name="password" type="password" minLength={10} autoComplete="new-password" required />
            </label>
            <div className={styles.fieldHint}>Use at least 10 characters.</div>

            <label>
              Confirm password
              <input name="password_confirmation" type="password" minLength={10} autoComplete="new-password" required />
            </label>

            <div className={styles.actions}>
              <button className="button primary" type="submit">Create research account</button>
              <div className={styles.divider}>Already registered?</div>
              <Link className={styles.secondaryAction} href="/login">Sign in instead</Link>
            </div>
          </form>

          <p className={styles.legal}>
            By creating an account you agree to the <Link href="/legal/terms">Terms of Service</Link> and acknowledge the <Link href="/legal/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
