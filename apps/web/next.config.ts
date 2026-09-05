import type { NextConfig } from "next";

const scriptSources = ["'self'", "'unsafe-inline'", "https://vercel.live"];
if (process.env.NODE_ENV === "development") scriptSources.push("'unsafe-eval'");

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' https://vercel.live https://vercel.com data: blob:",
  "font-src 'self' https://vercel.live https://assets.vercel.com data:",
  "style-src 'self' https://vercel.live 'unsafe-inline'",
  `script-src ${scriptSources.join(" ")}`,
  "connect-src 'self' https: wss://ws-us3.pusher.com http://localhost:* http://127.0.0.1:*",
  "frame-src https://vercel.live",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Content-Security-Policy",
          value: contentSecurityPolicy,
        },
      ],
    }];
  },
};

export default nextConfig;
