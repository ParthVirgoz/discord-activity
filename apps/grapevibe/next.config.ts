import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  /**
   * When BACKEND_URL is set (Vercel frontend + Render backend), proxy API and
   * Socket.IO polling to the real server. Leave unset on Render / Docker.
   */
  async rewrites() {
    if (!backendUrl) return [];
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
      { source: "/socket.io", destination: `${backendUrl}/socket.io` },
      { source: "/socket.io/:path*", destination: `${backendUrl}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
