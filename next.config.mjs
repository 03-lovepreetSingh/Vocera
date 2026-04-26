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
    }
    return cfg;
  },
};

export default config;
