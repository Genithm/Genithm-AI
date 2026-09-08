import { createVerify } from "node:crypto";

type WiseJson = Record<string, unknown>;

type WiseConfig = {
  apiToken: string;
  profileId: string;
  livemode: boolean;
  baseUrl: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getWiseConfig(): WiseConfig {
  const apiToken = required("WISE_API_TOKEN");
  const profileId = required("WISE_PROFILE_ID");
  const environment = (process.env.WISE_ENVIRONMENT?.trim().toLowerCase() || "sandbox") as "sandbox" | "live";
  if (!["sandbox", "live"].includes(environment)) throw new Error("WISE_ENVIRONMENT must be sandbox or live");
  return {
    apiToken,
    profileId,
    livemode: environment === "live",
    baseUrl: environment === "live" ? "https://api.wise.com" : "https://api.sandbox.transferwise.tech",
  };
}

export function getWiseSetupState() {
  const apiToken = process.env.WISE_API_TOKEN?.trim() ?? "";
  const profileId = process.env.WISE_PROFILE_ID?.trim() ?? "";
  const webhookKey = process.env.WISE_WEBHOOK_PUBLIC_KEY?.trim() ?? "";
  const environment = process.env.WISE_ENVIRONMENT?.trim().toLowerCase() || "sandbox";
  return {
    credentialsConfigured: Boolean(apiToken && profileId),
    webhookConfigured: webhookKey.includes("BEGIN PUBLIC KEY"),
    livemode: environment === "live",
  };
}

async function wiseJson(response: Response): Promise<WiseJson> {
  const payload = (await response.json().catch(() => ({}))) as WiseJson;
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Wise request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function wiseRequest(
  path: string,
  options: { method?: "GET" | "POST" | "PUT"; body?: unknown; correlationId?: string } = {},
) {
  const config = getWiseConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiToken}`,
    "Content-Type": "application/json",
  };
  if (options.correlationId) headers["X-External-Correlation-Id"] = options.correlationId;
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  return wiseJson(response);
}

export async function verifyWiseConnection() {
  const config = getWiseConfig();
  const profiles = await wiseRequest("/v2/profiles");
  const list = Array.isArray(profiles) ? profiles : Array.isArray((profiles as any).data) ? (profiles as any).data : [];
  const profile = list.find((entry: unknown) => {
    const object = wiseObject(entry);
    return object && String(object.id) === config.profileId;
  });
  if (!profile) throw new Error("Configured Wise profile was not returned by the API token");
  return { profileId: config.profileId, livemode: config.livemode };
}

export function verifyWiseWebhook(rawBody: string, signature: string | null) {
  const publicKey = required("WISE_WEBHOOK_PUBLIC_KEY").replace(/\\n/g, "\n");
  if (!signature) throw new Error("Wise webhook signature is missing");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(rawBody, "utf8");
  verifier.end();
  if (!verifier.verify(publicKey, signature, "base64")) throw new Error("Wise webhook signature is invalid");
}

export async function createWiseQuote(input: {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: number;
  targetAmount?: number;
}) {
  const config = getWiseConfig();
  return wiseRequest(`/v3/profiles/${encodeURIComponent(config.profileId)}/quotes`, {
    method: "POST",
    body: {
      sourceCurrency: input.sourceCurrency.toUpperCase(),
      targetCurrency: input.targetCurrency.toUpperCase(),
      sourceAmount: input.sourceAmount ?? null,
      targetAmount: input.targetAmount ?? null,
    },
  });
}

export async function createWiseTransfer(input: {
  targetAccount: string;
  quoteUuid: string;
  customerTransactionId: string;
  reference?: string;
}) {
  return wiseRequest("/v1/transfers", {
    method: "POST",
    correlationId: input.customerTransactionId,
    body: {
      targetAccount: input.targetAccount,
      quoteUuid: input.quoteUuid,
      customerTransactionId: input.customerTransactionId,
      details: input.reference ? { reference: input.reference } : undefined,
    },
  });
}

export function wiseObject(value: unknown): WiseJson | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as WiseJson) : null;
}

export function wiseText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export function wiseNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
