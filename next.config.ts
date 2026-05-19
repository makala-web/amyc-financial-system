import type { NextConfig } from 'next';

const isCapacitorExport = process.env.CAPACITOR_EXPORT === '1';

const nextConfig: NextConfig = {
  output: isCapacitorExport ? 'export' : undefined,
  images: {
    unoptimized: isCapacitorExport,
  },
  trailingSlash: isCapacitorExport,
};

export default nextConfig;
