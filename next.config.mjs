/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '110mb' },
    serverComponentsExternalPackages: ['pg', 'argon2', 'pdf-parse', 'mammoth', 'ws'],
  },
  webpack: (cfg, { isServer, dev }) => {
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
      // Inline the webpack runtime into every entry so `__webpack_require__.n`
      // and friends are always available. Without this, Next 14 + dev mode +
      // certain custom-server setups intermittently load chunks before the
      // runtime helpers are registered, causing "n is not a function".
      if (dev) {
        cfg.optimization = {
          ...(cfg.optimization ?? {}),
          runtimeChunk: false,
          splitChunks: false,
        };
      }
    }
    return cfg;
  },
};

export default config;
