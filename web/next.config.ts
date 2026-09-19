import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so a stray lockfile in a parent folder isn't picked up.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
