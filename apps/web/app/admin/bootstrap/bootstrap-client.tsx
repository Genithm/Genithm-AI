"use client";

import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type AALState = {
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
};

type TotpSetup = {
  factorId: string;
  qrCode: string;
  secret: string;
};

function qrSource(qrCode: string) {
  if (qrCode.startsWith("data:")) return qrCode;
  if (qrCode.trimStart().startsWith("<svg")) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}`;
  }
  return qrCode;
}

export default function PlatformAdminBootstrapClient() {
  const supabase = useMemo(() => createClient(), []);
  const [aal, setAal] = useState<AALState>({ currentLevel: null, nextLevel: null });
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("Checking MFA status…");
  const [busy, setBusy] = useState(false);

  async function refreshState() {
    const [aalResult, factorsResult] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (aalResult.error) throw aalResult.error;
    if (factorsResult.error) throw factorsResult.error;

    const verifiedTotp = factorsResult.data.totp.find((factor) => factor.status === "verified") ?? null;
    setVerifiedFactorId(verifiedTotp?.id ?? null);
    setAal({
      currentLevel: aalResult.data.currentLevel,
      nextLevel: aalResult.data.nextLevel,
    });
    if (aalResult.data.currentLevel === "aal2") {
      setMessage("MFA verified. This session is AAL2 and can activate the first platform admin.");
    } else if (verifiedTotp) {
      setMessage("A verified authenticator is enrolled. Enter its current 6-digit code to upgrade this session to AAL2.");
    } else {
      setMessage("No verified authenticator is enrolled. Start TOTP setup to continue.");
    }
  }

  useEffect(() => {
    refreshState().catch(() => setMessage("MFA status could not be loaded."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginEnrollment() {
    setBusy(true);
    setMessage("Starting authenticator enrollment…");
    try {
      const result = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Genithm Platform Admin",
      });
      if (result.error) throw result.error;
      setSetup({
        factorId: result.data.id,
        qrCode: result.data.totp.qr_code,
        secret: result.data.totp.secret,
      });
      setVerifiedFactorId(null);
      setMessage("Scan the QR code in your authenticator app, then enter the current 6-digit code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authenticator enrollment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    const factorId = setup?.factorId ?? verifiedFactorId;
    if (!factorId || !/^\d{6}$/.test(code.trim())) {
      setMessage("Enter a valid 6-digit authenticator code.");
      return;
    }

    setBusy(true);
    setMessage("Verifying authenticator code…");
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (result.error) throw result.error;
      setSetup(null);
      setCode("");
      await refreshState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authenticator verification failed.");
    } finally {
      setBusy(false);
    }
  }

  const aal2 = aal.currentLevel === "aal2";

  return (
    <div className="stack">
      <div className={aal2 ? "notice" : "item"}>
        <strong>MFA status</strong>
        <div className="small">Current: {aal.currentLevel ?? "checking"} · Next: {aal.nextLevel ?? "checking"}</div>
        <div className="small">{message}</div>
      </div>

      {!aal2 && !verifiedFactorId && !setup ? (
        <button className="button primary" type="button" onClick={beginEnrollment} disabled={busy}>
          Set up authenticator
        </button>
      ) : null}

      {setup ? (
        <div className="card">
          <div className="eyebrow">Authenticator enrollment</div>
          <h3>Scan this QR code</h3>
          <p className="small">Use Google Authenticator, Microsoft Authenticator, 1Password, Authy, or another TOTP-compatible app.</p>
          {/* The QR code contains the TOTP enrollment secret and is shown only in this authenticated browser session. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSource(setup.qrCode)} alt="Genithm authenticator QR code" width={220} height={220} />
          <details style={{ marginTop: 10 }}>
            <summary>Cannot scan? Show setup key</summary>
            <code style={{ overflowWrap: "anywhere" }}>{setup.secret}</code>
          </details>
        </div>
      ) : null}

      {!aal2 && (verifiedFactorId || setup) ? (
        <div className="stack">
          <label>
            6-digit authenticator code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <button className="button primary" type="button" onClick={verifyCode} disabled={busy || code.length !== 6}>
            Verify MFA
          </button>
        </div>
      ) : null}

      {aal2 ? (
        <form action="/api/admin/bootstrap" method="post">
          <button className="button primary" type="submit">Activate first platform admin</button>
        </form>
      ) : null}
    </div>
  );
}
