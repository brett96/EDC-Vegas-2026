/**
 * Merge into your Next.js portfolio `next.config.js` (or rename to `next.config.cjs`).
 *
 * 1) **Redirect** `/edc` → `/edc/` so the browser treats `/edc/` as a directory.
 *    Otherwise `./css/app.css` on a `/edc` URL resolves to `/css/app.css` (wrong).
 *
 * 2) **Rewrites** proxy `/edc/` and `/edc/*` to the standalone EDC Vercel deployment.
 *    `/edc/` must map to `index.html` after the redirect (the old `/edc`-only rewrite
 *    never runs for the browser once redirects send `/edc` → `/edc/`).
 */
module.exports = {
  async redirects() {
    return [
      {
        source: "/edc",
        destination: "/edc/",
        permanent: true,
      },
    ];
  },

  async rewrites() {
    return [
      {
        source: "/edc/",
        destination: "https://edc-vegas-2026.vercel.app/index.html",
      },
      {
        source: "/edc/:path*",
        destination: "https://edc-vegas-2026.vercel.app/:path*",
      },
    ];
  },
};
