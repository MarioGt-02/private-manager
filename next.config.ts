import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.VERCEL === undefined ? { output: "standalone" } : {}),
};

export default nextConfig;
