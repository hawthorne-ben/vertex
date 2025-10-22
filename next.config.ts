import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 85, 90, 95], // Configure allowed quality values
  },
  // Disable file watching in dev - hot reload is unreliable
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: false,
        ignored: ['**/*']
      }
    }
    return config
  }
}

export default nextConfig

