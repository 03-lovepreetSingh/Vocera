/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '110mb' },
    serverComponentsExternalPackages: ['pg', 'argon2', 'pdf-parse', 'mammoth', 'ws'],
  },
  webpack: (cfg, { isServer }) => {
    cfg.resolve.alias = { ...cfg.resolve.alias, canvas: false };
    if (!isServer) {
      cfg.resolve.fallback = {
        ...cfg.resolve.fallback,
        'pg-native': false,
        crypto: false,
        fs: false,
        net: false,
        tls: false,
        dns: false,
      };
      // The dev-only `splitChunks: false` workaround that previously lived here
      // was for a `__webpack_require__.n is not a function` crash caused by
      // lucide-react. Lucide is gone (replaced with inline icons in
      // src/components/icons.tsx), so the workaround is no longer needed —
      // and disabling chunk-splitting was making every page bundle one big
      // chunk, so any edit re-hashed every page and triggered chronic
      // ChunkLoadError on stale tabs. Restoring Next 14 defaults here.
    }
    return cfg;
  },
};

export default config;
