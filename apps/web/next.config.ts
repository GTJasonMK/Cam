import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@cam/shared'],
  output: 'standalone',
  // 生产构建跳过 lint 和类型检查（开发阶段已验证）
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // dockerode 依赖原生 .node 模块（cpu-features, ssh2），不可被 webpack 打包
  serverExternalPackages: ['dockerode', 'ssh2', 'cpu-features', 'better-sqlite3', 'node-pty'],
  // 关闭开发模式 devtools 指示器，规避 Next.js 15.5.x 在 monorepo 下
  // SegmentViewNode / segment-explorer-node 组件的 React Client Manifest 报错
  devIndicators: false,
  experimental: {
    // 在当前 monorepo 环境下，开启 webpack build worker 会导致构建失败但不输出具体错误。
    // 关闭后可获得稳定、可诊断的构建行为（代价：构建速度略慢）。
    webpackBuildWorker: false,
    // 将 barrel import 转为直接路径导入，消除未使用代码的打包
    optimizePackageImports: [
      'lucide-react',
      'sonner',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-dialog',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ],
  },
};

export default nextConfig;
