type PayPalJson = Record<string, unknown>;

type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  livemode: boolean;
  baseUrl: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getPayPalConfig(requireWebhook = false): PayPalConfig {
  const clientId = required("PAYPAL_CLIENT_ID");
  const clientSecret = required("PAYPAL_CLIENT_SECRET");
  const environment = (process.env.PAYPAL_ENVIRONMENT?.trim().toLowerCase() || "sandbox") as "sandbox" | "live";
  if (!['sandbox','live'].includes(environment)) throw new Error("PAYPAL_ENVIRONMENT must be sandbox or live");
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim() || undefined;
  if (requireWebhook && !webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  return {
    clientId,
    clientSecret,
    webhookId,
    livemode: environment === "live",
    baseUrl: environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}

export function getPayPalSetupState() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() ?? "";
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim() ?? "";
  const environment = process.env.PAYPAL_ENVIRONMENT?.trim().toLowerCase() || "sandbox";
  return {
    credentialsConfigured: Boolean(clientId && clientSecret),
    webhookConfigured: Boolean(webhookId),
    livemode: environment === "live",
  };
}

async function paypalJson(response: Response): Promise<PayPalJson> {
  const payload = (await response.json().catch(() => ({}))) as PayPalJson;
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : `PayPal request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function getPayPalAccessToken() {
  const config = getPayPalConfig();
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const payload = await paypalJson(response);
  if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("PayPal access token response is invalid");
  return payload.access_token;
}

export async function paypalRequest(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; requestId?: string } = {},
) {
  const config = getPayPalConfig();
  const token = await getPayPalAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options.requestId) headers["PayPal-Request-Id"] = options.requestId.slice(0, 78);
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  return paypalJson(response);
}

export async function verifyPayPalWebhook(rawBody: string, headers: Headers) {
  const config = getPayPalConfig(true);
  const event = JSON.parse(rawBody) as PayPalJson;
  const token = await getPayPalAccessToken();
  const response = await fetch(`${config.baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_time: headers.get("paypal-transmission-time"),
      cert_url: headers.get("paypal-cert-url"),
      auth_algo: headers.get("paypal-auth-algo"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      webhook_id: config.webhookId,
      webhook_event: event,
    }),
    cache: "no-store",
  });
  const payload = await paypalJson(response);
  if (payload.verification_status !== "SUCCESS") throw new Error("PayPal webhook signature is invalid");
  return event;
}

export function paypalObject(value: unknown): PayPalJson | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PayPalJson) : null;
}

export function paypalText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export function paypalLink(payload: PayPalJson, rel: string) {
  const links = Array.isArray(payload.links) ? payload.links : [];
  for (const raw of links) {
    const link = paypalObject(raw);
    if (link && link.rel === rel && typeof link.href === "string") return link.href;
  }
  return null;
}

export function paypalMoneyToMinor(value: unknown) {
  const amount = paypalObject(value);
  if (!amount || typeof amount.value !== "string") return 0;
  const numeric = Number(amount.value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}
