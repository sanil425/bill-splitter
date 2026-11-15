import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Runtime prompts are read from disk, so make sure they ship with the routes that use them.
  outputFileTracingIncludes: {
    "/api/attribute": ["./prompts/attribution.v2.md"],
    "/api/parse-receipt": ["./prompts/receipt.v1.md"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
