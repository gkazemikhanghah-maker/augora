/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @augora/core ships raw .ts with .js-style ESM specifiers; transpile it and
  // let webpack resolve ".js" imports to their ".ts" sources.
  transpilePackages: ["@augora/core"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
module.exports = nextConfig;
