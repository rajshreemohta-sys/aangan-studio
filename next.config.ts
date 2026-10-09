import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The classifier reads its prompt and the studio's rules from disk at runtime.
  outputFileTracingIncludes: {
    "/**": ["./prompts/classifier.md", "./context/services.md", "./context/qualified.md", "./data/phone-transcripts.json"],
  },
};

export default nextConfig;
