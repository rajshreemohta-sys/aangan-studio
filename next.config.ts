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
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
  // The classifier reads its prompt and the studio's rules from disk at runtime.
  outputFileTracingIncludes: {
    "/**": ["./prompts/classifier.md", "./context/services.md", "./context/qualified.md", "./data/phone-transcripts.json"],
  },
};

export default nextConfig;
