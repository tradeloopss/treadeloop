/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Lets other devices on the local network (e.g. a Windows PC used for
  // MetaTrader) open this dev server directly, not just localhost.
  allowedDevOrigins: ["192.168.100.119"],
}

export default nextConfig
