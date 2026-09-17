import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const localApiProxyTarget = process.env.GENITHM_LOCAL_API_PROXY_TARGET?.replace(/\/$/, "");
const codespaceWebHost =
  process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : undefined;
const codespaceAllowedOrigins = codespaceWebHost ? [codespaceWebHost] : [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: codespaceAllowedOrigins,
  experimental: {
    serverActions: {
      allowedOrigins: codespaceAllowedOrigins,
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  async rewrites() {
    if (!localApiProxyTarget) return [];
    return [
      {
        source: "/genithm-api/:path*",
        destination: `${localApiProxyTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
