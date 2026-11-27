import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Online players must run the same build: the commit is the version join_match compares
function buildId(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = { env: { NEXT_PUBLIC_BUILD_ID: buildId() } };

export default nextConfig;
