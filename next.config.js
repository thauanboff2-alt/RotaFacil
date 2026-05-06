/** @type {import('next').NextConfig} */

// Content Security Policy
// - script-src: 'unsafe-inline' required for Next.js hydration chunks
// - style-src: allows Google Fonts CSS import used in globals.css
// - font-src: allows Google Fonts actual font files
// - connect-src: fetch() calls go only to same-origin /api routes (all Google APIs are proxied server-side)
// - frame-ancestors/X-Frame-Options: prevents clickjacking
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Prevent clickjacking (legacy + modern CSP frame-ancestors)
  { key: "X-Frame-Options", value: "DENY" },

  // Control referrer information
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Restrict browser features — only geolocation from same origin
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },

  // Content Security Policy
  { key: "Content-Security-Policy", value: CSP },

  // HSTS — forces HTTPS for 2 years (only effective when served over HTTPS)
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },

  // Prevent cross-origin information leaks
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  // Strip server-side source maps from production builds (no code exposure)
  productionBrowserSourceMaps: false,

  // Compress responses
  compress: true,
};

module.exports = nextConfig;
