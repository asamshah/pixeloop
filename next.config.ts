import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / gRPC packages must not be bundled.
  serverExternalPackages: ["@libsql/client", "libsql", "google-ads-api", "google-gax", "@grpc/grpc-js"],
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
