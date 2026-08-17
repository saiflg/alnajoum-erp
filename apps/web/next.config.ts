import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // Traces only the dependencies this app actually needs into
  // .next/standalone, so the production Docker image doesn't have to ship
  // the whole pnpm workspace's node_modules. See Dockerfile and
  // DEPLOYMENT.md for how the standalone output is packaged.
  output: "standalone",
};

export default nextConfig;
