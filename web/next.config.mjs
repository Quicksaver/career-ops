import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants.js";
import { careerOpsUserId } from "./src/lib/user-context.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Two lockfiles exist on purpose (repo root + web/), so Next would infer the
  // repo root as the workspace root. On Windows that misinference can send
  // Turbopack's postcss workers into an unbounded respawn loop that exhausts
  // all RAM (vercel/next.js#92978) — pin the root to this app.
  turbopack: { root: import.meta.dirname },
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
};

export default function config(phase) {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    careerOpsUserId();
  }
  return nextConfig;
}
