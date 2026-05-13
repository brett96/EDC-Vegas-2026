/**
 * Copy this into your Next.js portfolio project's `next.config.js` (or merge `rewrites`).
 * Order matters: `/edc` before `/edc/:path*`.
 *
 * Optional: redirect `/edc` → `/edc/` so relative asset URLs in the PWA resolve correctly:
 *   async redirects() {
 *     return [{ source: '/edc', destination: '/edc/', permanent: true }];
 *   },
 *
 * If the service worker is proxied at `yoursite.com/edc/sw.js`, add on the portfolio
 * project (not this repo): `Service-Worker-Allowed: /` for that path if the browser
 * complains about scope (usually not needed when SW lives under `/edc/`).
 */
module.exports = {
  async rewrites() {
    return [
      {
        source: "/edc",
        destination: "https://edc-vegas-2026.vercel.app/index.html",
      },
      {
        source: "/edc/:path*",
        destination: "https://edc-vegas-2026.vercel.app/:path*",
      },
    ];
  },
};
