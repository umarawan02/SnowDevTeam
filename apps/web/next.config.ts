import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages spawn their own binaries / read their own files at runtime and
  // must not be bundled by Next's server compiler.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "@servicenow/sdk"],
};

export default nextConfig;
