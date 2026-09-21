import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  async redirects() {
    // /privat ersattes av BERRYiT HEMMA – behåll gamla länkar.
    return [{ source: "/privat", destination: "/hemma", permanent: true }];
  },
};

export default nextConfig;
