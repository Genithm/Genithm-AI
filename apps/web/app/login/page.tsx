import { headers } from "next/headers";

import { login, signup } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = `${protocol}://${host}`;

  return (
    <main className="container">
      <section className="auth-shell card">
        <div className="eyebrow">Genithm workspace</div>
        <h2>Sign in or create an account</h2>
        <p>Your scientific workspace is protected by Supabase Auth and database-level Row Level Security.</p>
        {params.error ? <p className="error">{params.error}</p> : null}
        {params.message ? <div className="notice">{params.message}</div> : null}
        <form className="stack">
          <input type="hidden" name="origin" value={origin} />
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" minLength={10} autoComplete="current-password" required /></label>
          <button className="button primary" formAction={login}>Sign in</button>
          <button className="button" formAction={signup}>Create account</button>
        </form>
        <p className="small">By creating an account you agree to the Terms of Service and acknowledge the Privacy Policy.</p>
      </section>
    </main>
  );
}
