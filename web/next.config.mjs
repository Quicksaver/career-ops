import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webRoot, "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: repoRoot,
  },
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
};

export default nextConfig;
