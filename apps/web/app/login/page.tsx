import Link from "next/link";
import { headers } from "next/headers";

import { login, signup } from "./actions";
import styles from "./login.module.css";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = `${protocol}://${host}`;

  return (
    <main className={`container ${styles.page}`}>
      <section className={styles.shell} aria-labelledby="auth-title">
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
              <div className="eyebrow">Secure research access</div>
              <h1>Enter a workspace built for reproducible biology.</h1>
              <p>
                Keep private sequence inputs, deterministic scientific tools, evidence, and provenance connected from the first upload to the final result.
              </p>
            </div>
          </div>

          <div className={styles.trustGrid} aria-label="Workspace trust properties">
            <div className={styles.trustItem}>
              <span>Identity</span>
              <strong>Supabase Auth protects researcher sessions.</strong>
            </div>
            <div className={styles.trustItem}>
              <span>Isolation</span>
              <strong>Row Level Security keeps workspace data scoped.</strong>
            </div>
            <div className={styles.trustItem}>
              <span>Evidence</span>
              <strong>Scientific results retain hashes and provenance.</strong>
            </div>
          </div>
        </div>

        <div className={styles.formPanel}>
          <Link className={styles.backLink} href="/">← Back to platform overview</Link>

          <div className={styles.formHeading}>
            <div className="eyebrow">Research workspace</div>
            <h2 id="auth-title">Sign in to Genithm</h2>
            <p>Use your existing account, or create one with the same secure credentials below.</p>
          </div>

          {params.error ? <div className={`error ${styles.feedback}`} role="alert">{params.error}</div> : null}
          {params.message ? <div className={`notice ${styles.feedback}`} role="status">{params.message}</div> : null}

          <form className={styles.form}>
            <input type="hidden" name="origin" value={origin} />
            <label>
              Email address
              <input name="email" type="email" autoComplete="email" inputMode="email" required aria-describedby="email-hint" />
            </label>
            <div className={styles.fieldHint} id="email-hint">Use the email address associated with your research workspace.</div>

            <label>
              Password
              <input name="password" type="password" minLength={10} autoComplete="current-password" required aria-describedby="password-hint" />
            </label>
            <div className={styles.fieldHint} id="password-hint">Minimum 10 characters. New accounts may require email confirmation before first sign-in.</div>

            <div className={styles.actions}>
              <button className="button primary" formAction={login}>Sign in to workspace</button>
              <div className={styles.divider}>New to Genithm?</div>
              <button className={styles.secondaryAction} formAction={signup}>Create a research account</button>
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
