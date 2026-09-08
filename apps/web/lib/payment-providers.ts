export type PaymentProviderKey = "stripe" | "paypal" | "wise";

export type PaymentProviderCapability =
  | "checkout"
  | "subscriptions"
  | "portal"
  | "invoices"
  | "refunds"
  | "disputes"
  | "payouts"
  | "transfers"
  | "webhooks";

export type PaymentProviderDefinition = {
  key: PaymentProviderKey;
  name: string;
  kind: "payment_processor" | "payout_rail" | "hybrid";
  capabilities: PaymentProviderCapability[];
  credentialEnv: string[];
  optionalEnv: string[];
};

export const PAYMENT_PROVIDERS: PaymentProviderDefinition[] = [
  {
    key: "stripe",
    name: "Stripe",
    kind: "hybrid",
    capabilities: ["checkout", "subscriptions", "portal", "invoices", "refunds", "disputes", "payouts", "webhooks"],
    credentialEnv: ["STRIPE_SECRET_KEY"],
    optionalEnv: ["STRIPE_WEBHOOK_SECRET"],
  },
  {
    key: "paypal",
    name: "PayPal",
    kind: "payment_processor",
    capabilities: ["checkout", "subscriptions", "invoices", "refunds", "disputes", "webhooks"],
    credentialEnv: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    optionalEnv: ["PAYPAL_WEBHOOK_ID", "PAYPAL_ENVIRONMENT"],
  },
  {
    key: "wise",
    name: "Wise",
    kind: "payout_rail",
    capabilities: ["payouts", "transfers", "webhooks"],
    credentialEnv: ["WISE_API_TOKEN", "WISE_PROFILE_ID"],
    optionalEnv: ["WISE_ENVIRONMENT", "WISE_WEBHOOK_PUBLIC_KEY"],
  },
];

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function getPaymentProviderSetupStates() {
  return PAYMENT_PROVIDERS.map((provider) => {
    const credentialsConfigured = provider.credentialEnv.every(configured);
    const optionalConfigured = Object.fromEntries(provider.optionalEnv.map((name) => [name, configured(name)]));
    return {
      ...provider,
      credentialsConfigured,
      optionalConfigured,
    };
  });
}
