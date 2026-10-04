import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@moviewatch/ui", "@moviewatch/contracts"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
};

export default nextConfig;
