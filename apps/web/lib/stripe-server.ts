import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/report-database.types";

type StripeJson = Record<string, unknown>;

type StripeConfig = {
  secretKey: string;
  webhookSecret?: string;
  livemode: boolean;
};

function requiredServerEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getStripeConfig(requireWebhook = false): StripeConfig {
  const secretKey = requiredServerEnv("STRIPE_SECRET_KEY");
  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_")) {
    throw new Error("STRIPE_SECRET_KEY has an unsupported format");
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
  if (requireWebhook && !webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  return { secretKey, webhookSecret, livemode: secretKey.startsWith("sk_live_") };
}

export function getStripeSetupState() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  return {
    secretKeyConfigured: secretKey.startsWith("sk_test_") || secretKey.startsWith("sk_live_"),
    webhookSecretConfigured: webhookSecret.startsWith("whsec_"),
    livemode: secretKey.startsWith("sk_live_"),
  };
}

export function getServiceSupabase() {
  const url = requiredServerEnv("SUPABASE_URL");
  const secretKey = requiredServerEnv("SUPABASE_SECRET_KEY");
  return createSupabaseClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function encodeParams(params: Record<string, string | number | boolean | null | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    body.set(key, String(value));
  }
  return body;
}

async function stripeResponse(response: Response): Promise<StripeJson> {
  const payload = (await response.json().catch(() => ({}))) as StripeJson;
  if (!response.ok) {
    const error = payload.error;
    const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : `Stripe request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function stripeFormRequest(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  options: { method?: "POST" | "DELETE"; idempotencyKey?: string } = {},
) {
  const { secretKey } = getStripeConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: options.method ?? "POST",
    headers,
    body: encodeParams(params),
    cache: "no-store",
  });
  return stripeResponse(response);
}

export async function stripeGet(path: string, params: Record<string, string | number | boolean | null | undefined> = {}) {
  const { secretKey } = getStripeConfig();
  const query = encodeParams(params).toString();
  const response = await fetch(`https://api.stripe.com/v1${path}${query ? `?${query}` : ""}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: "no-store",
  });
  return stripeResponse(response);
}

function secureEqualHex(left: string, right: string) {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right) || left.length !== right.length) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyStripeWebhook(rawBody: string, signatureHeader: string | null, toleranceSeconds = 300) {
  const { webhookSecret } = getStripeConfig(true);
  if (!webhookSecret || !signatureHeader) throw new Error("Stripe webhook signature is missing");

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || !Number.isFinite(timestamp) || !signatures.length) throw new Error("Stripe webhook signature is malformed");
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) throw new Error("Stripe webhook signature timestamp is outside tolerance");

  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  if (!signatures.some((signature) => secureEqualHex(signature, expected))) throw new Error("Stripe webhook signature is invalid");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stripeId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

export function stripeObject(value: unknown): StripeJson | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as StripeJson) : null;
}

export function stripeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stripeTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

export function stripeDate(value: unknown): string | null {
  const iso = stripeTimestamp(value);
  return iso ? iso.slice(0, 10) : null;
}

export function safeReturnOrigin(requestUrl: string) {
  const configured = process.env.GENITHM_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(requestUrl);
  return url.origin;
}
