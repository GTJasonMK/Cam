import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@cam/shared'],
  output: 'standalone',
  // dockerode 依赖原生 .node 模块（cpu-features, ssh2），不可被 webpack 打包
  serverExternalPackages: ['dockerode', 'ssh2', 'cpu-features', 'better-sqlite3'],
  // 关闭开发模式 devtools 指示器，规避 Next.js 15.5.x 在 monorepo 下
  // SegmentViewNode / segment-explorer-node 组件的 React Client Manifest 报错
  devIndicators: false,
};

export default nextConfig;
